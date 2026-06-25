import { Storage } from "../storage";
import {
  candidateFromRemote,
  fallbackCandidates,
  FREE_ROUTER_MODEL,
  OpenRouterModelRecord
} from "../modelCatalog";
import { callModel as callOpenRouter, OpenRouterError } from "../openrouterClient";
import { classifyProviderError } from "./providerError";
import {
  AIProvider,
  ProviderCallOptions,
  ProviderCallResult,
  ProviderHealthResult,
  ProviderHealthStatus,
  ProviderModel
} from "./types";

export class OpenRouterProvider implements AIProvider {
  readonly id = "openrouter" as const;
  readonly displayName = "OpenRouter";
  readonly priority = 4;

  constructor(private readonly storage: Storage) {}

  async isConfigured(): Promise<boolean> {
    return Boolean(await this.storage.getApiKey());
  }

  async listModels(): Promise<ProviderModel[]> {
    const key = await this.storage.getApiKey();
    if (!key) return [];
    let records: OpenRouterModelRecord[] = [];
    try {
      const response = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok) throw new OpenRouterError("OpenRouter model list is unavailable.", response.status);
      const body = await response.json() as { data?: OpenRouterModelRecord[] };
      records = body.data ?? [];
    } catch {
      records = fallbackCandidates.map((candidate) => ({
        id: candidate.id,
        name: candidate.displayName,
        description: candidate.tags.join(" "),
        context_length: candidate.contextWindow,
        pricing: candidate.isFree ? { prompt: "0", completion: "0" } : { prompt: "1", completion: "1" }
      }));
    }
    const models = records
      .map(candidateFromRemote)
      .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
      .map(toProviderModel);
    models.push({
      providerId: this.id,
      id: FREE_ROUTER_MODEL,
      displayName: "OpenRouter Free Models Router",
      isFreeTier: true,
      isPaid: false,
      supportsCoding: true,
      supportsReasoning: true,
      recommendedUseCases: ["patch", "explain", "tests", "general"]
    });
    return deduplicate(models);
  }

  async callModel(options: ProviderCallOptions): Promise<ProviderCallResult> {
    const key = await this.storage.getApiKey();
    if (!key) throw new Error("OpenRouter is not configured.");
    const text = await callOpenRouter({
      apiKey: key,
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.1,
      timeoutMs: options.timeoutMs
    });
    return { text, providerId: this.id, model: options.model };
  }

  async healthCheck(model: ProviderModel): Promise<ProviderHealthResult> {
    if (model.id === FREE_ROUTER_MODEL) return { status: "Ready", checkedAt: Date.now() };
    const started = Date.now();
    try {
      await this.callModel({
        model: model.id,
        messages: [{ role: "user", content: "Reply exactly with OK." }],
        temperature: 0,
        timeoutMs: 10_000,
        useCase: "general"
      });
      const latencyMs = Date.now() - started;
      return { status: latencyMs > 6_000 ? "Slow" : "Ready", checkedAt: Date.now(), latencyMs };
    } catch (error) {
      const status = this.classifyError(error);
      const retryAfterMs = (error as { retryAfterMs?: number }).retryAfterMs;
      return {
        status: retryAfterMs && status === "RateLimited" ? "Cooldown" : status,
        checkedAt: Date.now(),
        retryAfterMs,
        cooldownUntil: retryAfterMs ? Date.now() + retryAfterMs : undefined
      };
    }
  }

  classifyError(error: unknown): ProviderHealthStatus {
    return classifyProviderError(error);
  }
}

function deduplicate(models: ProviderModel[]): ProviderModel[] {
  return [...new Map(models.map((model) => [model.id, model])).values()];
}

function toProviderModel(candidate: NonNullable<ReturnType<typeof candidateFromRemote>>): ProviderModel {
  return {
    providerId: "openrouter",
    id: candidate.id,
    displayName: candidate.displayName,
    isFreeTier: candidate.isFree,
    isPaid: candidate.isPaid,
    supportsCoding: candidate.knownCodingCapability !== "unknown",
    supportsReasoning: candidate.knownReasoningCapability !== "unknown",
    supportsStructuredOutput: true,
    supportsLongContext: Boolean(candidate.contextWindow && candidate.contextWindow >= 32_000),
    contextWindow: candidate.contextWindow,
    recommendedUseCases: [
      ...(candidate.recommendedForPatchGeneration ? ["patch" as const] : []),
      ...(candidate.recommendedForExplain ? ["explain" as const, "general" as const] : []),
      ...(candidate.recommendedForTests ? ["tests" as const] : []),
      ...(candidate.knownReasoningCapability !== "unknown" ? ["planning" as const, "review" as const] : [])
    ]
  };
}
