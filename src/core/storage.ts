import * as vscode from "vscode";

const API_KEY = "codecrew.openrouterApiKey";
const PROVIDER_SECRET_KEYS = {
  openrouter: API_KEY,
  gemini: "codecrew.gemini.apiKey",
  cerebras: "codecrew.cerebras.apiKey",
  groq: "codecrew.groq.apiKey",
  "github-models": "codecrew.githubModels.token",
  mistral: "codecrew.mistral.apiKey",
  "cloudflare-workers-ai.accountId": "codecrew.cloudflare.accountId",
  "cloudflare-workers-ai.apiToken": "codecrew.cloudflare.apiToken",
  huggingface: "codecrew.huggingface.token"
} as const;

export type ProviderSecretSlot = keyof typeof PROVIDER_SECRET_KEYS;

export class Storage {
  constructor(private readonly context: vscode.ExtensionContext) {}

  getApiKey(): Thenable<string | undefined> {
    return this.context.secrets.get(API_KEY);
  }

  async setApiKey(value: string): Promise<void> {
    await this.context.secrets.store(API_KEY, value);
  }

  getProviderSecret(slot: ProviderSecretSlot): Thenable<string | undefined> {
    return this.context.secrets.get(PROVIDER_SECRET_KEYS[slot]);
  }

  async setProviderSecret(slot: ProviderSecretSlot, value: string): Promise<void> {
    await this.context.secrets.store(PROVIDER_SECRET_KEYS[slot], value);
  }

  async deleteProviderSecret(slot: ProviderSecretSlot): Promise<void> {
    await this.context.secrets.delete(PROVIDER_SECRET_KEYS[slot]);
  }

  get<T>(key: string, fallback: T): T {
    return this.context.globalState.get<T>(key, fallback);
  }

  update<T>(key: string, value: T): Thenable<void> {
    return this.context.globalState.update(key, value);
  }
}
