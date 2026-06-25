import { callModel, ModelCall, OpenRouterError } from "./openrouterClient";
import { healthCheck } from "./healthCheck";
import { fallbackCandidates, FREE_ROUTER_MODEL, mergeModelCatalog, OpenRouterModelRecord } from "./modelCatalog";
import {
  ModelCandidate,
  ModelHealth,
  ModelRuntimeStats,
  ModelSettings,
  ModelTask,
  ScoredModel
} from "../types/model";
import {
  defaultModelSettings,
  loadModelStats,
  ModelStateStorage,
  recordModelAttempt
} from "./modelSettings";
import { createHash } from "node:crypto";
import { ProtectedFileError } from "./protectedFiles";

export { FREE_ROUTER_MODEL } from "./modelCatalog";

export const NO_FREE_MODEL_MESSAGE =
  "No free coding model is available right now. Try again later or enable paid fallback.";
export const PAID_CONFIRMATION_MESSAGE =
  "Paid fallback is enabled. CodeCrew may use a paid model for this request. Continue?";

export class InvalidModelResponseError extends Error {
  constructor() {
    super("The model returned an invalid patch response.");
  }
}

interface RoutedCallOptions {
  input: Omit<ModelCall, "model">;
  settings: ModelSettings;
  task: ModelTask;
  storage: ModelStateStorage;
  onFallback?: () => void;
  confirmPaid?: () => Promise<boolean>;
  validateResponse?: (content: string, modelId: string) => boolean;
  fetchModels?: (apiKey: string) => Promise<OpenRouterModelRecord[]>;
  call?: typeof callModel;
  checkHealth?: typeof healthCheck;
}

export interface RoutedModelResult {
  content: string;
  model: string;
  isPaid: boolean;
}

export async function callWithModelSettings(options: RoutedCallOptions): Promise<RoutedModelResult> {
  const fetchModels = options.fetchModels ?? fetchOpenRouterModels;
  const remote = await fetchModels(options.input.apiKey).catch(() => []);
  const catalog = mergeModelCatalog(remote);
  const stats = loadModelStats(options.storage);
  const freePool = freeCandidatesForSettings(catalog, options.settings);
  const freeHealth = await checkCandidateHealth(
    options.input.apiKey,
    freePool,
    options.settings,
    stats,
    options.task,
    options.checkHealth
  );
  const freePlan = buildRoutingPlan(options.settings, freePool, freeHealth, stats, options.task, false);
  let invalidResponseSeen = false;
  const freeAttempt = await tryModels(freePlan, false, options);
  const freeResult = freeAttempt.result;
  invalidResponseSeen ||= freeAttempt.invalidResponseSeen;
  if (freeResult) return freeResult;

  if (!options.settings.paidFallbackEnabled || options.settings.selectedPaidModelIds.length === 0) {
    if (invalidResponseSeen) throw new InvalidModelResponseError();
    throw new Error(NO_FREE_MODEL_MESSAGE);
  }
  if (!options.confirmPaid || !(await options.confirmPaid())) {
    if (invalidResponseSeen) throw new InvalidModelResponseError();
    throw new Error(NO_FREE_MODEL_MESSAGE);
  }

  const paidPool = catalog.filter(
    (candidate) => candidate.isPaid && options.settings.selectedPaidModelIds.includes(candidate.id)
  );
  const paidHealth = await checkCandidateHealth(
    options.input.apiKey,
    paidPool,
    options.settings,
    stats,
    options.task,
    options.checkHealth
  );
  const paidPlan = buildRoutingPlan(options.settings, paidPool, paidHealth, stats, options.task, true);
  const paidAttempt = await tryModels(paidPlan, true, options);
  invalidResponseSeen ||= paidAttempt.invalidResponseSeen;
  if (paidAttempt.result) return paidAttempt.result;
  if (invalidResponseSeen) throw new InvalidModelResponseError();
  throw new Error(NO_FREE_MODEL_MESSAGE);
}

export function buildRoutingPlan(
  settings: ModelSettings,
  candidates: ModelCandidate[],
  health: Record<string, ModelHealth>,
  stats: Record<string, ModelRuntimeStats>,
  task: ModelTask,
  paid: boolean
): ScoredModel[] {
  const eligible = candidates.filter((candidate) => {
    if (paid) {
      return settings.paidFallbackEnabled &&
        settings.selectedPaidModelIds.includes(candidate.id) &&
        health[candidate.id]?.state === "Ready";
    }
    return candidate.isFree && health[candidate.id]?.state === "Ready";
  });
  return eligible
    .map((candidate) => {
      const scored = scoreModel(candidate, health[candidate.id], stats[candidate.id], task);
      if (!paid && settings.manualPreferredModelsEnabled && settings.selectedFreeModelIds.includes(candidate.id)) {
        scored.score += 5000;
      }
      return scored;
    })
    .sort((a, b) => {
      if (task === "patch" && a.candidate.id === FREE_ROUTER_MODEL) return 1;
      if (task === "patch" && b.candidate.id === FREE_ROUTER_MODEL) return -1;
      return b.score - a.score;
    });
}

export function scoreModel(
  candidate: ModelCandidate,
  health: ModelHealth,
  stats: ModelRuntimeStats | undefined,
  task: ModelTask
): ScoredModel {
  let score = health.state === "Ready" ? 1000 : health.state === "Slow" ? 200 : -1000;
  score += candidate.isFree ? 180 : -120;
  score += capabilityScore(candidate.knownCodingCapability) * (task === "explain" ? 1 : 2);
  score += capabilityScore(candidate.knownReasoningCapability);
  if (task === "patch" && candidate.recommendedForPatchGeneration) score += 160;
  if (task === "explain" && candidate.recommendedForExplain) score += 100;
  if (task === "tests" && candidate.recommendedForTests) score += 140;
  if (candidate.contextWindow) score += Math.min(60, Math.log2(candidate.contextWindow) * 3);
  if (health.latencyMs) score -= Math.min(120, health.latencyMs / 100);
  if (stats?.attempts) {
    score -= (stats.failures / stats.attempts) * 300;
    score -= (stats.invalidPatchResponses / stats.attempts) * 500;
    score += (stats.successfulPatches / stats.attempts) * 180;
    if (stats.averageLatencyMs) score -= Math.min(100, stats.averageLatencyMs / 100);
  }
  if (candidate.id === FREE_ROUTER_MODEL && task === "patch") score -= 10_000;
  return {
    candidate,
    health,
    score,
    badge: candidate.isPaid
      ? "Paid"
      : health.state !== "Ready"
        ? health.state === "Busy" || health.state === "Slow" ? "Busy" : "Not available"
        : score >= 1300 ? "Recommended" : "Good fallback"
  };
}

export function freeCandidatesForSettings(
  catalog: ModelCandidate[],
  settings: ModelSettings
): ModelCandidate[] {
  const free = catalog.filter((candidate) => candidate.isFree);
  if (!settings.manualPreferredModelsEnabled) return free;
  const selected = free.filter((candidate) => settings.selectedFreeModelIds.includes(candidate.id));
  if (!settings.allowAutomaticFreeFallback) return selected;
  return [...selected, ...free.filter((candidate) => !settings.selectedFreeModelIds.includes(candidate.id))];
}

export function buildFreeCandidateList(preferred: string, discovered: string[]): string[] {
  const settings = {
    ...defaultModelSettings,
    manualPreferredModelsEnabled: true,
    selectedFreeModelIds: [preferred],
    allowAutomaticFreeFallback: true
  };
  const catalog = mergeModelCatalog(discovered.map((id) => ({ id, name: id, pricing: { prompt: "0", completion: "0" } })));
  return freeCandidatesForSettings(catalog, settings).map((candidate) => candidate.id);
}

export function isGuaranteedFreeModel(model: string): boolean {
  return model === FREE_ROUTER_MODEL || model.endsWith(":free");
}

export async function fetchOpenRouterModels(apiKey: string): Promise<OpenRouterModelRecord[]> {
  const cacheKey = createHash("sha256").update(apiKey).digest("hex").slice(0, 12);
  const cached = modelListCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < 5 * 60_000) return cached.models;
  const response = await fetch("https://openrouter.ai/api/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10_000)
  });
  if (!response.ok) throw new OpenRouterError("OpenRouter model list is unavailable.", response.status);
  const body = await response.json() as { data?: OpenRouterModelRecord[] };
  const models = body.data ?? [];
  modelListCache.set(cacheKey, { fetchedAt: Date.now(), models });
  return models;
}

const modelListCache = new Map<string, { fetchedAt: number; models: OpenRouterModelRecord[] }>();

async function checkCandidateHealth(
  apiKey: string,
  candidates: ModelCandidate[],
  settings: ModelSettings,
  stats: Record<string, ModelRuntimeStats>,
  task: ModelTask,
  checker: typeof healthCheck = healthCheck
): Promise<Record<string, ModelHealth>> {
  const limited = rankCandidatesForHealthCheck(candidates, settings, stats, task)
    .filter((candidate) => candidate.id !== FREE_ROUTER_MODEL)
    .slice(0, 8);
  const results = await Promise.all(limited.map((candidate) => checker(apiKey, candidate.id)));
  const health = Object.fromEntries(results.map((result) => [result.modelId, result]));
  if (candidates.some((candidate) => candidate.id === FREE_ROUTER_MODEL)) {
    health[FREE_ROUTER_MODEL] = { modelId: FREE_ROUTER_MODEL, state: "Ready" };
  }
  return health;
}

export function rankCandidatesForHealthCheck(
  candidates: ModelCandidate[],
  settings: ModelSettings,
  stats: Record<string, ModelRuntimeStats>,
  task: ModelTask
): ModelCandidate[] {
  return [...candidates].sort((a, b) => {
    const selectedA = settings.manualPreferredModelsEnabled && settings.selectedFreeModelIds.includes(a.id) ? 5000 : 0;
    const selectedB = settings.manualPreferredModelsEnabled && settings.selectedFreeModelIds.includes(b.id) ? 5000 : 0;
    const scoreA = scoreModel(a, { modelId: a.id, state: "Untested" }, stats[a.id], task).score + selectedA;
    const scoreB = scoreModel(b, { modelId: b.id, state: "Untested" }, stats[b.id], task).score + selectedB;
    if (task === "patch" && a.id === FREE_ROUTER_MODEL) return 1;
    if (task === "patch" && b.id === FREE_ROUTER_MODEL) return -1;
    return scoreB - scoreA;
  });
}

async function tryModels(
  plan: ScoredModel[],
  isPaid: boolean,
  options: RoutedCallOptions
): Promise<{ result?: RoutedModelResult; invalidResponseSeen: boolean }> {
  const caller = options.call ?? callModel;
  let invalidResponseSeen = false;
  for (let index = 0; index < plan.length; index++) {
    const modelId = plan[index].candidate.id;
    const started = Date.now();
    try {
      const content = await caller({ ...options.input, model: modelId });
      const valid = options.validateResponse?.(content, modelId) ?? true;
      if (!valid) {
        invalidResponseSeen = true;
        await recordModelAttempt(options.storage, modelId, "invalidPatch", Date.now() - started, options.task);
        if (!isPaid && index < plan.length - 1) options.onFallback?.();
        continue;
      }
      await recordModelAttempt(options.storage, modelId, "success", Date.now() - started, options.task);
      return { result: { content, model: modelId, isPaid }, invalidResponseSeen };
    } catch (error) {
      if (error instanceof ProtectedFileError) throw error;
      if (error instanceof OpenRouterError && (error.status === 401 || error.status === 402)) throw error;
      await recordModelAttempt(options.storage, modelId, "failure", Date.now() - started, options.task);
      if (!isPaid && index < plan.length - 1) options.onFallback?.();
    }
  }
  return { invalidResponseSeen };
}

function capabilityScore(level: ModelCandidate["knownCodingCapability"]): number {
  return level === "high" ? 120 : level === "medium" ? 70 : level === "low" ? 20 : 0;
}
