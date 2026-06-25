import { FREE_ROUTER_MODEL } from "../modelCatalog";
import { ProtectedFileError } from "../protectedFiles";
import {
  loadModelSettings,
  loadModelStats,
  ModelStateStorage,
  recordModelAttempt
} from "../modelSettings";
import { loadProviderSettings } from "./providerSettings";
import { cachedProviderHealth, mapWithConcurrency } from "./providerHealthCache";
import type { ProviderRegistry } from "./providerRegistry";
import {
  AIProvider,
  ModelUseCase,
  ProviderCallResult,
  ProviderHealthResult,
  ProviderModel
} from "./types";

export const NO_FREE_PROVIDER_MESSAGE =
  "No free AI provider is available right now. Add a free provider API key or try again later.";

export class InvalidProviderResponseError extends Error {
  constructor() {
    super("Configured AI providers returned invalid patch output.");
  }
}

export interface FreeFirstRouterOptions {
  storage: ModelStateStorage;
  registry: ProviderRegistry;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
  timeoutMs: number;
  useCase: ModelUseCase;
  validateResponse?: (text: string, providerId: string, modelId: string) => boolean;
  confirmPaid?: () => Promise<boolean>;
  onFallback?: () => void;
  forceHealthRefresh?: boolean;
}

interface Candidate {
  provider: AIProvider;
  model: ProviderModel;
  health: ProviderHealthResult;
  score: number;
}

const patchProbeCache = new Map<string, { valid: boolean; checkedAt: number }>();

export function clearPatchProbeCache(): void {
  patchProbeCache.clear();
}

export async function callWithFreeProviders(options: FreeFirstRouterOptions): Promise<ProviderCallResult> {
  const providerSettings = loadProviderSettings(options.storage);
  const modelSettings = loadModelSettings(options.storage);
  const configured = await options.registry.configured(providerSettings.enabledProviderIds);
  if (configured.length === 0) throw new Error(NO_FREE_PROVIDER_MESSAGE);

  const listed = await Promise.all(configured.map(async (provider) => ({
    provider,
    models: await provider.listModels().catch(() => [])
  })));
  const allFree = listed.flatMap(({ provider, models }) =>
    rankModelsBeforeHealth(models, options.useCase)
      .filter((model) => model.isFreeTier && !model.isPaid && supportsUseCase(model, options.useCase))
      .filter((model) => allowOpenRouterFreeModel(model, modelSettings))
      .slice(0, 2)
      .map((model) => ({ provider, model }))
  );
  const freePrepared = await prepareCandidates(allFree, options);
  let invalidResponseSeen = false;
  invalidResponseSeen ||= freePrepared.invalidPatchSeen;
  const freeAttempt = await tryCandidates(freePrepared.candidates, false, options);
  invalidResponseSeen ||= freeAttempt.invalidResponseSeen;
  if (freeAttempt.result) return freeAttempt.result;

  if (!modelSettings.paidFallbackEnabled || modelSettings.selectedPaidModelIds.length === 0) {
    if (invalidResponseSeen) throw new InvalidProviderResponseError();
    throw new Error(NO_FREE_PROVIDER_MESSAGE);
  }
  if (!options.confirmPaid || !(await options.confirmPaid())) {
    if (invalidResponseSeen) throw new InvalidProviderResponseError();
    throw new Error(NO_FREE_PROVIDER_MESSAGE);
  }

  const paidModels = listed.flatMap(({ provider, models }) =>
    models
      .filter((model) => model.isPaid && modelSettings.selectedPaidModelIds.includes(model.id))
      .filter((model) => supportsUseCase(model, options.useCase))
      .map((model) => ({ provider, model }))
  );
  const paidPrepared = await prepareCandidates(paidModels, options);
  invalidResponseSeen ||= paidPrepared.invalidPatchSeen;
  const paidAttempt = await tryCandidates(paidPrepared.candidates, true, options);
  invalidResponseSeen ||= paidAttempt.invalidResponseSeen;
  if (paidAttempt.result) return paidAttempt.result;
  if (invalidResponseSeen) throw new InvalidProviderResponseError();
  throw new Error(NO_FREE_PROVIDER_MESSAGE);
}

export function rankModelsBeforeHealth(models: ProviderModel[], useCase: ModelUseCase): ProviderModel[] {
  return [...models].sort((a, b) => {
    if (useCase === "patch" && a.id === FREE_ROUTER_MODEL) return 1;
    if (useCase === "patch" && b.id === FREE_ROUTER_MODEL) return -1;
    const score = (model: ProviderModel) =>
      (model.supportsCoding ? 300 : 0) +
      (model.supportsReasoning ? 120 : 0) +
      (model.supportsStructuredOutput ? 100 : 0) +
      (model.contextWindow ? Math.min(80, Math.log2(model.contextWindow) * 4) : 0);
    return score(b) - score(a);
  });
}

async function prepareCandidates(
  values: Array<{ provider: AIProvider; model: ProviderModel }>,
  options: FreeFirstRouterOptions
): Promise<{ candidates: Candidate[]; invalidPatchSeen: boolean }> {
  const checked = await mapWithConcurrency(values.slice(0, 16), 2, async ({ provider, model }) => ({
    provider,
    model,
    health: await cachedProviderHealth(provider, model, options.forceHealthRefresh)
  }));
  const ready = checked.filter((item) => item.health.status === "Ready");
  const stats = loadModelStats(options.storage);
  const scored = ready
    .map((candidate) => ({
      ...candidate,
      score: candidateScore(
        candidate.provider,
        candidate.model,
        candidate.health,
        stats[statKey(candidate.provider.id, candidate.model.id)],
        options.useCase
      )
    }));
  return {
    candidates: weaveProviders(scored),
    invalidPatchSeen: false
  };
}

async function tryCandidates(
  candidates: Candidate[],
  paid: boolean,
  options: FreeFirstRouterOptions
): Promise<{ result?: ProviderCallResult; invalidResponseSeen: boolean }> {
  let invalidResponseSeen = false;
  for (let index = 0; index < candidates.length; index++) {
    const { provider, model } = candidates[index];
    if (options.useCase === "patch") {
      const reliable = await checkPatchReliability(provider, model, options.validateResponse);
      if (!reliable) {
        invalidResponseSeen = true;
        await recordModelAttempt(options.storage, statKey(provider.id, model.id), "invalidPatch", 0, "patch");
        if (!paid && index < candidates.length - 1) options.onFallback?.();
        continue;
      }
    }
    const started = Date.now();
    try {
      const result = await provider.callModel({
        model: model.id,
        messages: options.messages,
        temperature: options.temperature,
        timeoutMs: options.timeoutMs,
        useCase: options.useCase
      });
      const valid = options.validateResponse?.(result.text, provider.id, model.id) ?? true;
      if (!valid) {
        invalidResponseSeen = true;
        await recordModelAttempt(options.storage, statKey(provider.id, model.id), "invalidPatch", Date.now() - started, toModelTask(options.useCase));
        if (!paid && index < candidates.length - 1) options.onFallback?.();
        continue;
      }
      await recordModelAttempt(options.storage, statKey(provider.id, model.id), "success", Date.now() - started, toModelTask(options.useCase));
      return { result, invalidResponseSeen };
    } catch (error) {
      if (error instanceof ProtectedFileError) throw error;
      await recordModelAttempt(options.storage, statKey(provider.id, model.id), "failure", Date.now() - started, toModelTask(options.useCase));
      if (!paid && index < candidates.length - 1) options.onFallback?.();
    }
  }
  return { invalidResponseSeen };
}

async function checkPatchReliability(
  provider: AIProvider,
  model: ProviderModel,
  validate: FreeFirstRouterOptions["validateResponse"]
): Promise<boolean> {
  if (!validate) return true;
  const key = `${provider.id}:${model.id}`;
  const cached = patchProbeCache.get(key);
  if (cached && Date.now() - cached.checkedAt < 10 * 60_000) return cached.valid;
  try {
    const result = await provider.callModel({
      model: model.id,
      messages: [{
        role: "user",
        content: `Return exactly this patch and nothing else:
<<<<<<< SEARCH
const x = 1;
=======
const x = 2;
>>>>>>> REPLACE`
      }],
      temperature: 0,
      timeoutMs: 10_000,
      useCase: "patch"
    });
    const valid = validate(result.text, provider.id, model.id);
    patchProbeCache.set(key, { valid, checkedAt: Date.now() });
    return valid;
  } catch (error) {
    if (error instanceof ProtectedFileError) throw error;
    patchProbeCache.set(key, { valid: false, checkedAt: Date.now() });
    return false;
  }
}

export function candidateScore(
  provider: AIProvider,
  model: ProviderModel,
  health: ProviderHealthResult,
  stats: { attempts: number; failures: number; invalidPatchResponses: number; successfulPatches: number; averageLatencyMs?: number } | undefined,
  useCase: ModelUseCase
): number {
  let score = 1200 - provider.priority * 40;
  if (model.supportsCoding) score += useCase === "patch" || useCase === "tests" ? 300 : 100;
  if (model.supportsReasoning) score += 120;
  if (model.supportsStructuredOutput) score += 100;
  if (model.contextWindow) score += Math.min(80, Math.log2(model.contextWindow) * 4);
  if (health.latencyMs) score -= Math.min(150, health.latencyMs / 75);
  if (stats?.attempts) {
    score -= (stats.failures / stats.attempts) * 350;
    score -= (stats.invalidPatchResponses / stats.attempts) * 600;
    score += (stats.successfulPatches / stats.attempts) * 180;
  }
  if (model.providerId === "openrouter" && model.id === FREE_ROUTER_MODEL && useCase === "patch") score -= 10_000;
  return score;
}

export function weaveProviders(candidates: Candidate[]): Candidate[] {
  const groups = new Map<string, Candidate[]>();
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    const group = groups.get(candidate.provider.id) ?? [];
    group.push(candidate);
    groups.set(candidate.provider.id, group);
  }
  const output: Candidate[] = [];
  while ([...groups.values()].some((group) => group.length)) {
    const heads = [...groups.values()].filter((group) => group.length).sort((a, b) => b[0].score - a[0].score);
    for (const group of heads) output.push(group.shift()!);
  }
  return output;
}

function supportsUseCase(model: ProviderModel, useCase: ModelUseCase): boolean {
  if (useCase === "patch" || useCase === "tests") return model.supportsCoding && model.recommendedUseCases.includes(useCase);
  if (useCase === "planning" || useCase === "review") return model.supportsReasoning;
  return model.recommendedUseCases.includes(useCase) || model.recommendedUseCases.includes("general");
}

function allowOpenRouterFreeModel(
  model: ProviderModel,
  settings: ReturnType<typeof loadModelSettings>
): boolean {
  if (model.providerId !== "openrouter" || !settings.manualPreferredModelsEnabled) return true;
  if (settings.selectedFreeModelIds.includes(model.id)) return true;
  return settings.allowAutomaticFreeFallback;
}

function statKey(providerId: string, modelId: string): string {
  return `${providerId}:${modelId}`;
}

function toModelTask(useCase: ModelUseCase): "patch" | "explain" | "tests" {
  return useCase === "patch" ? "patch" : useCase === "tests" ? "tests" : "explain";
}
