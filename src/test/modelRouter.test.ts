import test from "node:test";
import assert from "node:assert/strict";
import {
  buildRoutingPlan,
  buildFreeCandidateList,
  callWithModelSettings,
  freeCandidatesForSettings,
  FREE_ROUTER_MODEL,
  isGuaranteedFreeModel,
  NO_FREE_MODEL_MESSAGE,
  PAID_CONFIRMATION_MESSAGE
} from "../core/modelRouter";
import { fallbackCandidates } from "../core/modelCatalog";
import { defaultModelSettings } from "../core/modelSettings";
import { ModelCandidate, ModelHealth, ModelRuntimeStats } from "../types/model";
import { rankCandidatesForHealthCheck } from "../core/modelRouter";

test("paid models never enter the automatic candidate list", () => {
  const candidates = buildFreeCandidateList("anthropic/claude-sonnet-4", [
    "openai/gpt-4.1",
    "qwen/qwen3-coder:free"
  ]);
  assert.ok(candidates.length > 0);
  assert.ok(candidates.every(isGuaranteedFreeModel));
  assert.ok(!candidates.includes("anthropic/claude-sonnet-4"));
});

test("candidate list is deduplicated", () => {
  const candidates = buildFreeCandidateList("qwen/qwen3-coder:free", ["qwen/qwen3-coder:free"]);
  assert.equal(candidates.filter((model) => model === "qwen/qwen3-coder:free").length, 1);
});

test("no-free-model message stays user-facing and does not expose routing details", () => {
  assert.equal(NO_FREE_MODEL_MESSAGE, "No free coding model is available right now. Try again later or enable paid fallback.");
  assert.doesNotMatch(NO_FREE_MODEL_MESSAGE, /qwen|deepseek|mistral/i);
});

test("the official OpenRouter free router is a guaranteed-free fallback", () => {
  const candidates = buildFreeCandidateList(FREE_ROUTER_MODEL, []);
  assert.ok(candidates.includes("openrouter/free"));
  assert.equal(isGuaranteedFreeModel(FREE_ROUTER_MODEL), true);
  assert.equal(isGuaranteedFreeModel("openrouter/auto"), false);
});

const freeA: ModelCandidate = {
  ...fallbackCandidates[0],
  id: "test/free-a:free",
  displayName: "Free A",
  knownCodingCapability: "high",
  knownReasoningCapability: "high",
  contextWindow: 128000
};
const freeB: ModelCandidate = {
  ...fallbackCandidates[0],
  id: "test/free-b:free",
  displayName: "Free B",
  knownCodingCapability: "medium",
  knownReasoningCapability: "medium",
  contextWindow: 64000
};
const paidA: ModelCandidate = {
  ...fallbackCandidates.at(-1)!,
  id: "test/paid-a",
  displayName: "Paid A"
};
const health = (id: string, state: ModelHealth["state"]): ModelHealth => ({ modelId: id, state });

test("Auto mode selects the highest recommended Ready free model", () => {
  const plan = buildRoutingPlan(
    defaultModelSettings,
    [freeB, freeA],
    { [freeA.id]: health(freeA.id, "Ready"), [freeB.id]: health(freeB.id, "Ready") },
    {},
    "patch",
    false
  );
  assert.equal(plan[0].candidate.id, freeA.id);
});

test("Failed, unavailable, busy, and slow models are not selected when Ready models exist", () => {
  const plan = buildRoutingPlan(
    defaultModelSettings,
    [freeA, freeB, { ...freeB, id: "failed:free" }],
    {
      [freeA.id]: health(freeA.id, "Busy"),
      [freeB.id]: health(freeB.id, "Ready"),
      "failed:free": health("failed:free", "Unavailable")
    },
    {},
    "patch",
    false
  );
  assert.deepEqual(plan.map((item) => item.candidate.id), [freeB.id]);
});

test("openrouter/free is last-resort fallback for patch generation", () => {
  const router = fallbackCandidates.find((candidate) => candidate.id === FREE_ROUTER_MODEL)!;
  const plan = buildRoutingPlan(
    defaultModelSettings,
    [router, freeB],
    { [router.id]: health(router.id, "Ready"), [freeB.id]: health(freeB.id, "Ready") },
    {},
    "patch",
    false
  );
  assert.equal(plan.at(-1)?.candidate.id, FREE_ROUTER_MODEL);
});

test("health checks prioritize manual selections and keep openrouter/free last for patches", () => {
  const router = fallbackCandidates.find((candidate) => candidate.id === FREE_ROUTER_MODEL)!;
  const ranked = rankCandidatesForHealthCheck(
    [freeA, router, freeB],
    {
      ...defaultModelSettings,
      autoMode: false,
      manualPreferredModelsEnabled: true,
      selectedFreeModelIds: [freeB.id]
    },
    {},
    "patch"
  );
  assert.equal(ranked[0].id, freeB.id);
  assert.equal(ranked.at(-1)?.id, FREE_ROUTER_MODEL);
});

test("Manual preferred list excludes unselected models when automatic free fallback is off", () => {
  const selected = freeCandidatesForSettings([freeA, freeB], {
    ...defaultModelSettings,
    autoMode: false,
    manualPreferredModelsEnabled: true,
    selectedFreeModelIds: [freeB.id],
    allowAutomaticFreeFallback: false
  });
  assert.deepEqual(selected.map((candidate) => candidate.id), [freeB.id]);
});

test("Manual preferred list may use other free models when automatic fallback is on", () => {
  const selected = freeCandidatesForSettings([freeA, freeB], {
    ...defaultModelSettings,
    autoMode: false,
    manualPreferredModelsEnabled: true,
    selectedFreeModelIds: [freeB.id],
    allowAutomaticFreeFallback: true
  });
  assert.deepEqual(selected.map((candidate) => candidate.id), [freeB.id, freeA.id]);
});

class MemoryStorage {
  private values = new Map<string, unknown>();
  get<T>(key: string, fallback: T): T { return (this.values.get(key) as T | undefined) ?? fallback; }
  async update<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
}

const remoteModels = [
  { id: freeA.id, name: freeA.displayName, description: "coding reasoning", pricing: { prompt: "0", completion: "0" } },
  { id: freeB.id, name: freeB.displayName, description: "coding reasoning", pricing: { prompt: "0", completion: "0" } },
  { id: paidA.id, name: paidA.displayName, description: "coding reasoning", pricing: { prompt: "0.1", completion: "0.2" } }
];

test("Auto mode uses fallback when the primary call fails", async () => {
  const calls: string[] = [];
  const result = await callWithModelSettings({
    input: { apiKey: "key", messages: [], temperature: 0, timeoutMs: 30_000 },
    settings: defaultModelSettings,
    task: "patch",
    storage: new MemoryStorage(),
    fetchModels: async () => remoteModels,
    checkHealth: async (_key, model) => health(model, "Ready"),
    call: async (input) => {
      calls.push(input.model);
      if (calls.length === 1) throw new Error("busy");
      return "valid";
    },
    validateResponse: () => true
  });
  assert.ok(calls.length >= 2);
  assert.notEqual(result.model, calls[0]);
});

test("Manual routing calls only selected Ready models when automatic fallback is disabled", async () => {
  const calls: string[] = [];
  const result = await callWithModelSettings({
    input: { apiKey: "key", messages: [], temperature: 0, timeoutMs: 30_000 },
    settings: {
      ...defaultModelSettings,
      autoMode: false,
      manualPreferredModelsEnabled: true,
      selectedFreeModelIds: [freeB.id],
      allowAutomaticFreeFallback: false
    },
    task: "patch",
    storage: new MemoryStorage(),
    fetchModels: async () => remoteModels,
    checkHealth: async (_key, model) => health(model, "Ready"),
    call: async (input) => { calls.push(input.model); return "valid"; }
  });
  assert.equal(result.model, freeB.id);
  assert.deepEqual(calls, [freeB.id]);
});

test("Manual routing can call another Ready free model when automatic fallback is enabled", async () => {
  const calls: string[] = [];
  const result = await callWithModelSettings({
    input: { apiKey: "key", messages: [], temperature: 0, timeoutMs: 30_000 },
    settings: {
      ...defaultModelSettings,
      autoMode: false,
      manualPreferredModelsEnabled: true,
      selectedFreeModelIds: [freeB.id],
      allowAutomaticFreeFallback: true
    },
    task: "patch",
    storage: new MemoryStorage(),
    fetchModels: async () => remoteModels,
    checkHealth: async (_key, model) => health(model, "Ready"),
    call: async (input) => {
      calls.push(input.model);
      if (input.model === freeB.id) throw new Error("selected busy");
      return "fallback";
    }
  });
  assert.equal(calls[0], freeB.id);
  assert.notEqual(result.model, freeB.id);
});

test("All free failures return the safe no-free-model message", async () => {
  await assert.rejects(callWithModelSettings({
    input: { apiKey: "key", messages: [], temperature: 0, timeoutMs: 30_000 },
    settings: defaultModelSettings,
    task: "patch",
    storage: new MemoryStorage(),
    fetchModels: async () => remoteModels,
    checkHealth: async (_key, model) => health(model, "Ready"),
    call: async () => { throw new Error("failed"); }
  }), new RegExp(NO_FREE_MODEL_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("Paid model is never called while paid fallback is disabled", async () => {
  const calls: string[] = [];
  await assert.rejects(callWithModelSettings({
    input: { apiKey: "key", messages: [], temperature: 0, timeoutMs: 30_000 },
    settings: { ...defaultModelSettings, selectedPaidModelIds: [paidA.id] },
    task: "patch",
    storage: new MemoryStorage(),
    fetchModels: async () => remoteModels,
    checkHealth: async (_key, model) => health(model, "Ready"),
    call: async (input) => { calls.push(input.model); throw new Error("failed"); },
    confirmPaid: async () => true
  }));
  assert.equal(calls.includes(paidA.id), false);
});

test("Paid fallback requires explicit confirmation", async () => {
  let confirmations = 0;
  const calls: string[] = [];
  const result = await callWithModelSettings({
    input: { apiKey: "key", messages: [], temperature: 0, timeoutMs: 30_000 },
    settings: {
      ...defaultModelSettings,
      paidFallbackEnabled: true,
      selectedPaidModelIds: [paidA.id]
    },
    task: "patch",
    storage: new MemoryStorage(),
    fetchModels: async () => remoteModels,
    checkHealth: async (_key, model) => health(model, "Ready"),
    call: async (input) => {
      calls.push(input.model);
      if (input.model === paidA.id) return "paid success";
      throw new Error("free failed");
    },
    confirmPaid: async () => { confirmations++; return true; }
  });
  assert.equal(PAID_CONFIRMATION_MESSAGE, "Paid fallback is enabled. CodeCrew may use a paid model for this request. Continue?");
  assert.equal(confirmations, 1);
  assert.equal(result.model, paidA.id);
  assert.equal(result.isPaid, true);
  assert.ok(calls.includes(paidA.id));
});

test("Canceling paid confirmation prevents any paid model call", async () => {
  const calls: string[] = [];
  await assert.rejects(callWithModelSettings({
    input: { apiKey: "key", messages: [], temperature: 0, timeoutMs: 30_000 },
    settings: {
      ...defaultModelSettings,
      paidFallbackEnabled: true,
      selectedPaidModelIds: [paidA.id]
    },
    task: "patch",
    storage: new MemoryStorage(),
    fetchModels: async () => remoteModels,
    checkHealth: async (_key, model) => health(model, "Ready"),
    call: async (input) => { calls.push(input.model); throw new Error("free failed"); },
    confirmPaid: async () => false
  }));
  assert.equal(calls.includes(paidA.id), false);
});

test("Invalid HTTP 200 patch response is treated as model failure and falls back", async () => {
  let attempts = 0;
  const result = await callWithModelSettings({
    input: { apiKey: "key", messages: [], temperature: 0, timeoutMs: 30_000 },
    settings: defaultModelSettings,
    task: "patch",
    storage: new MemoryStorage(),
    fetchModels: async () => remoteModels,
    checkHealth: async (_key, model) => health(model, "Ready"),
    call: async () => ++attempts === 1 ? "not a patch" : "valid patch",
    validateResponse: (content) => content === "valid patch"
  });
  assert.ok(attempts >= 2);
  assert.equal(result.content, "valid patch");
});
