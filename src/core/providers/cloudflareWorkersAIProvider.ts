import { Storage } from "../storage";
import { classifyProviderError } from "./providerError";
import { fetchJson } from "./providerFetch";
import { providerModel } from "./staticModels";
import {
  AIProvider,
  ProviderCallOptions,
  ProviderCallResult,
  ProviderHealthResult,
  ProviderHealthStatus,
  ProviderModel
} from "./types";

export class CloudflareWorkersAIProvider implements AIProvider {
  readonly id = "cloudflare-workers-ai" as const;
  readonly displayName = "Cloudflare Workers AI";
  readonly priority = 7;
  private readonly models = [
    providerModel(this.id, "@cf/qwen/qwen2.5-coder-32b-instruct", "Qwen 2.5 Coder 32B"),
    providerModel(this.id, "@cf/meta/llama-3.3-70b-instruct-fp8-fast", "Llama 3.3 70B")
  ];

  constructor(private readonly storage: Storage) {}

  async isConfigured(): Promise<boolean> {
    const [accountId, token] = await Promise.all([
      this.storage.getProviderSecret("cloudflare-workers-ai.accountId"),
      this.storage.getProviderSecret("cloudflare-workers-ai.apiToken")
    ]);
    return Boolean(accountId && token);
  }

  async listModels(): Promise<ProviderModel[]> { return this.models; }

  async callModel(options: ProviderCallOptions): Promise<ProviderCallResult> {
    const [accountId, token] = await Promise.all([
      this.storage.getProviderSecret("cloudflare-workers-ai.accountId"),
      this.storage.getProviderSecret("cloudflare-workers-ai.apiToken")
    ]);
    if (!accountId || !token) throw new Error("Cloudflare Workers AI is not configured.");
    const body = await fetchJson(
      `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${options.model}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messages: options.messages, temperature: options.temperature ?? 0.1 })
      },
      options.timeoutMs
    );
    const text = (body as { result?: { response?: string } }).result?.response;
    if (!text) throw new Error("Cloudflare Workers AI returned an invalid response.");
    return { text, providerId: this.id, model: options.model, raw: body };
  }

  async healthCheck(model: ProviderModel): Promise<ProviderHealthResult> {
    const started = Date.now();
    try {
      await this.callModel({ model: model.id, messages: [{ role: "user", content: "Reply exactly with OK." }], timeoutMs: 10_000, useCase: "general" });
      return { status: "Ready", checkedAt: Date.now(), latencyMs: Date.now() - started };
    } catch (error) {
      return { status: this.classifyError(error), checkedAt: Date.now() };
    }
  }

  classifyError(error: unknown): ProviderHealthStatus { return classifyProviderError(error); }
}
