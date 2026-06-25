import { Storage } from "../storage";
import { CerebrasProvider } from "./cerebrasProvider";
import { CloudflareWorkersAIProvider } from "./cloudflareWorkersAIProvider";
import { GeminiProvider } from "./geminiProvider";
import { GitHubModelsProvider } from "./githubModelsProvider";
import { GroqProvider } from "./groqProvider";
import { HuggingFaceProvider } from "./huggingFaceProvider";
import { MistralProvider } from "./mistralProvider";
import { OpenRouterProvider } from "./openrouterProvider";
import { AIProvider, ProviderId } from "./types";

export class ProviderRegistry {
  private readonly providers: AIProvider[];

  constructor(storage: Storage) {
    this.providers = [
      new GeminiProvider(storage),
      new CerebrasProvider(storage),
      new GroqProvider(storage),
      new OpenRouterProvider(storage),
      new GitHubModelsProvider(storage),
      new MistralProvider(storage),
      new CloudflareWorkersAIProvider(storage),
      new HuggingFaceProvider(storage)
    ];
  }

  all(): AIProvider[] {
    return [...this.providers];
  }

  get(id: ProviderId): AIProvider | undefined {
    return this.providers.find((provider) => provider.id === id);
  }

  async configured(enabledIds?: ProviderId[]): Promise<AIProvider[]> {
    const allowed = enabledIds ? new Set(enabledIds) : undefined;
    const configured = await Promise.all(this.providers.map(async (provider) => ({
      provider,
      configured: (!allowed || allowed.has(provider.id)) && await provider.isConfigured()
    })));
    return configured
      .filter((item) => item.configured)
      .map((item) => item.provider)
      .sort((a, b) => a.priority - b.priority);
  }
}
