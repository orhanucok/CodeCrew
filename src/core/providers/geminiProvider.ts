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

export class GeminiProvider implements AIProvider {
  readonly id = "gemini" as const;
  readonly displayName = "Gemini API";
  readonly priority = 1;
  private readonly models = [
    providerModel(this.id, "gemini-2.5-flash", "Gemini 2.5 Flash", { contextWindow: 1048576 }),
    providerModel(this.id, "gemini-2.5-flash-lite", "Gemini 2.5 Flash Lite", { contextWindow: 1048576 })
  ];

  constructor(private readonly storage: Storage) {}

  async isConfigured(): Promise<boolean> {
    return Boolean(await this.storage.getProviderSecret("gemini"));
  }

  async listModels(): Promise<ProviderModel[]> {
    return this.models;
  }

  async callModel(options: ProviderCallOptions): Promise<ProviderCallResult> {
    const key = await this.storage.getProviderSecret("gemini");
    if (!key) throw new Error("Gemini API is not configured.");
    const system = options.messages.filter((message) => message.role === "system").map((message) => message.content).join("\n");
    const contents = options.messages
      .filter((message) => message.role !== "system")
      .map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }]
      }));
    const body = await fetchJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(options.model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "x-goog-api-key": key,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          systemInstruction: system ? { parts: [{ text: system }] } : undefined,
          contents,
          generationConfig: { temperature: options.temperature ?? 0.1 }
        })
      },
      options.timeoutMs
    );
    const text = (body as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> })
      .candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
    if (!text) throw new Error("Gemini returned an invalid response.");
    return { text, providerId: this.id, model: options.model, raw: body };
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
      return { status: this.classifyError(error), checkedAt: Date.now() };
    }
  }

  classifyError(error: unknown): ProviderHealthStatus {
    return classifyProviderError(error);
  }
}
