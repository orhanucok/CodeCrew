import test from "node:test";
import assert from "node:assert/strict";
import {
  callWithFreeProviders,
  candidateScore,
  InvalidProviderResponseError,
  NO_FREE_PROVIDER_MESSAGE,
  weaveProviders
} from "../core/providers/freeFirstRouter";
import {
  AIProvider,
  ProviderCallOptions,
  ProviderHealthResult,
  ProviderHealthStatus,
  ProviderId,
  ProviderModel
} from "../core/providers/types";
import { defaultModelSettings } from "../core/modelSettings";
import { defaultProviderSettings } from "../core/providers/providerSettings";

class MemoryStorage {
  private values = new Map<string, unknown>();
  get<T>(key: string, fallback: T): T { return (this.values.get(key) as T | undefined) ?? fallback; }
  async update<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
  seed<T>(key: string, value: T): void { this.values.set(key, value); }
}

class FakeProvider implements AIProvider {
  calls = 0;
  healthCalls = 0;
  constructor(
    readonly id: ProviderId,
    readonly displayName: string,
    readonly priority: number,
    private configured: boolean,
    private models: ProviderModel[],
    private response: string | Error,
    private health: ProviderHealthStatus = "Ready"
  ) {}
  async isConfigured(): Promise<boolean> { return this.configured; }
  async listModels(): Promise<ProviderModel[]> { return this.models; }
  async healthCheck(): Promise<ProviderHealthResult> {
    this.healthCalls++;
    return { status: this.health, checkedAt: Date.now() };
  }
  async callModel(options: ProviderCallOptions) {
    this.calls++;
    if (this.response instanceof Error) throw this.response;
    return { text: this.response, providerId: this.id, model: options.model };
  }
  classifyError(): ProviderHealthStatus { return "Unavailable"; }
}

const model = (providerId: ProviderId, id = `${providerId}-code`): ProviderModel => ({
  providerId,
  id,
  displayName: id,
  isFreeTier: true,
  isPaid: false,
  supportsCoding: true,
  supportsReasoning: true,
  supportsStructuredOutput: true,
  contextWindow: 32000,
  recommendedUseCases: ["patch", "explain", "tests", "general"]
});
const paidModel = (providerId: ProviderId, id = `${providerId}-paid`): ProviderModel => ({
  ...model(providerId, id),
  isFreeTier: false,
  isPaid: true
});

class FakeRegistry {
  constructor(private providers: FakeProvider[]) {}
  async configured(enabled: ProviderId[]) {
    const values = await Promise.all(this.providers.map(async (provider) => ({
      provider,
      configured: enabled.includes(provider.id) && await provider.isConfigured()
    })));
    return values.filter((value) => value.configured).map((value) => value.provider);
  }
}

function storage(): MemoryStorage {
  const value = new MemoryStorage();
  value.seed("codecrew.modelSettings", defaultModelSettings);
  value.seed("codecrew.providerSettings", defaultProviderSettings);
  return value;
}

const validPatch = `<<<<<<< SEARCH
const x = 1;
=======
const x = 2;
>>>>>>> REPLACE`;

test("configured Ready provider is used and missing providers are skipped safely", async () => {
  const missing = new FakeProvider("gemini", "Gemini", 1, false, [model("gemini")], validPatch);
  const ready = new FakeProvider("groq", "Groq", 3, true, [model("groq")], validPatch);
  const result = await callWithFreeProviders({
    storage: storage(),
    registry: new FakeRegistry([missing, ready]) as never,
    messages: [],
    timeoutMs: 30_000,
    useCase: "patch",
    validateResponse: (text) => text === validPatch
  });
  assert.equal(result.providerId, "groq");
  assert.equal(missing.calls, 0);
});

test("router falls back from a failed provider to another configured provider", async () => {
  const gemini = new FakeProvider("gemini", "Gemini", 1, true, [model("gemini")], new Error("busy"));
  const groq = new FakeProvider("groq", "Groq", 3, true, [model("groq")], validPatch);
  const result = await callWithFreeProviders({
    storage: storage(),
    registry: new FakeRegistry([gemini, groq]) as never,
    messages: [],
    timeoutMs: 30_000,
    useCase: "patch",
    validateResponse: (text) => text === validPatch
  });
  assert.equal(result.providerId, "groq");
});

test("invalid patch output falls back and is never returned", async () => {
  const gemini = new FakeProvider("gemini", "Gemini", 1, true, [model("gemini")], "not a patch");
  const groq = new FakeProvider("groq", "Groq", 3, true, [model("groq")], validPatch);
  const result = await callWithFreeProviders({
    storage: storage(),
    registry: new FakeRegistry([gemini, groq]) as never,
    messages: [],
    timeoutMs: 30_000,
    useCase: "patch",
    validateResponse: (text) => text === validPatch
  });
  assert.equal(result.text, validPatch);
  assert.equal(result.providerId, "groq");
});

test("all invalid patch outputs fail safely", async () => {
  const gemini = new FakeProvider("gemini", "Gemini", 1, true, [model("gemini")], "bad");
  await assert.rejects(callWithFreeProviders({
    storage: storage(),
    registry: new FakeRegistry([gemini]) as never,
    messages: [],
    timeoutMs: 30_000,
    useCase: "patch",
    validateResponse: () => false
  }), InvalidProviderResponseError);
});

test("paid provider model is never called without per-request confirmation", async () => {
  const paid = new FakeProvider("openrouter", "OpenRouter", 4, true, [paidModel("openrouter")], validPatch);
  const value = storage();
  value.seed("codecrew.modelSettings", {
    ...defaultModelSettings,
    paidFallbackEnabled: true,
    selectedPaidModelIds: ["openrouter-paid"]
  });
  let confirmations = 0;
  await assert.rejects(callWithFreeProviders({
    storage: value,
    registry: new FakeRegistry([paid]) as never,
    messages: [],
    timeoutMs: 30_000,
    useCase: "patch",
    validateResponse: (text) => text === validPatch,
    confirmPaid: async () => { confirmations++; return false; }
  }));
  assert.equal(confirmations, 1);
  assert.equal(paid.calls, 0);
});

test("confirmed paid fallback is limited to the selected model", async () => {
  const selected = new FakeProvider(
    "openrouter",
    "OpenRouter",
    4,
    true,
    [paidModel("openrouter", "selected-paid"), paidModel("openrouter", "unselected-paid")],
    validPatch
  );
  const value = storage();
  value.seed("codecrew.modelSettings", {
    ...defaultModelSettings,
    paidFallbackEnabled: true,
    selectedPaidModelIds: ["selected-paid"]
  });
  const result = await callWithFreeProviders({
    storage: value,
    registry: new FakeRegistry([selected]) as never,
    messages: [],
    timeoutMs: 30_000,
    useCase: "patch",
    validateResponse: (text) => text === validPatch,
    confirmPaid: async () => true
  });
  assert.equal(result.model, "selected-paid");
});

test("no configured provider returns the safe provider message", async () => {
  await assert.rejects(callWithFreeProviders({
    storage: storage(),
    registry: new FakeRegistry([]) as never,
    messages: [],
    timeoutMs: 30_000,
    useCase: "patch"
  }), new RegExp(NO_FREE_PROVIDER_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("dynamic score favors coding and healthy providers over raw model size", () => {
  const provider = new FakeProvider("groq", "Groq", 3, true, [], validPatch);
  const coding = model("groq", "coding");
  const hugeNonCoding = { ...model("groq", "huge"), supportsCoding: false, contextWindow: 2_000_000 };
  const health = { status: "Ready" as const, checkedAt: Date.now(), latencyMs: 100 };
  assert.ok(candidateScore(provider, coding, health, undefined, "patch") >
    candidateScore(provider, hugeNonCoding, health, undefined, "patch"));
});

test("candidate weaving switches provider before a second model from the same provider", () => {
  const gemini = new FakeProvider("gemini", "Gemini", 1, true, [], validPatch);
  const groq = new FakeProvider("groq", "Groq", 3, true, [], validPatch);
  const health = { status: "Ready" as const, checkedAt: Date.now() };
  const ordered = weaveProviders([
    { provider: gemini, model: model("gemini", "g1"), health, score: 1000 },
    { provider: gemini, model: model("gemini", "g2"), health, score: 900 },
    { provider: groq, model: model("groq", "q1"), health, score: 800 }
  ]);
  assert.deepEqual(ordered.slice(0, 3).map((item) => item.provider.id), ["gemini", "groq", "gemini"]);
});
