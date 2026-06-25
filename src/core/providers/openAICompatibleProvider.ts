import { Storage, ProviderSecretSlot } from "../storage";
import { classifyProviderError } from "./providerError";
import { extractOpenAIText, fetchJson } from "./providerFetch";
import {
  AIProvider,
  ProviderCallOptions,
  ProviderCallResult,
  ProviderHealthResult,
  ProviderHealthStatus,
  ProviderId,
  ProviderModel
} from "./types";

export abstract class OpenAICompatibleProvider implements AIProvider {
  abstract id: ProviderId;
  abstract displayName: string;
  abstract priority: number;
  protected abstract secretSlot: ProviderSecretSlot;
  protected abstract baseUrl: string;
  protected abstract models: ProviderModel[];
  protected additionalHeaders(): Record<string, string> { return {}; }

  constructor(protected readonly storage: Storage) {}

  async isConfigured(): Promise<boolean> {
    return Boolean(await this.storage.getProviderSecret(this.secretSlot));
  }

  async listModels(): Promise<ProviderModel[]> {
    return this.models;
  }

  async healthCheck(model: ProviderModel): Promise<ProviderHealthResult> {
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
        status: retryAfterMs && (status === "RateLimited" || status === "Unavailable") ? "Cooldown" : status,
        checkedAt: Date.now(),
        retryAfterMs,
        cooldownUntil: retryAfterMs ? Date.now() + retryAfterMs : undefined
      };
    }
  }

  async callModel(options: ProviderCallOptions): Promise<ProviderCallResult> {
    const key = await this.storage.getProviderSecret(this.secretSlot);
    if (!key) throw new Error(`${this.displayName} is not configured.`);
    const body = await fetchJson(
      `${this.baseUrl}/chat/completions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          ...this.additionalHeaders()
        },
        body: JSON.stringify({
          model: options.model,
          messages: options.messages,
          temperature: options.temperature ?? 0.1
        })
      },
      options.timeoutMs
    );
    return { text: extractOpenAIText(body), providerId: this.id, model: options.model, raw: body };
  }

  classifyError(error: unknown): ProviderHealthStatus {
    return classifyProviderError(error);
  }
}
