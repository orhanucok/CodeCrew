import { ProviderId, ProviderSettings } from "./types";
import { ModelStateStorage } from "../modelSettings";

const KEY = "codecrew.providerSettings";

export const providerPriority: ProviderId[] = [
  "gemini",
  "cerebras",
  "groq",
  "openrouter",
  "github-models",
  "mistral",
  "cloudflare-workers-ai",
  "huggingface"
];

export const defaultProviderSettings: ProviderSettings = {
  enabledProviderIds: [...providerPriority]
};

export function loadProviderSettings(storage: ModelStateStorage): ProviderSettings {
  const value = storage.get<ProviderSettings>(KEY, defaultProviderSettings);
  return {
    enabledProviderIds: providerPriority.filter((id) => value.enabledProviderIds?.includes(id))
  };
}

export async function saveProviderSettings(
  storage: ModelStateStorage,
  value: ProviderSettings
): Promise<ProviderSettings> {
  const sanitized = {
    enabledProviderIds: providerPriority.filter((id) => value.enabledProviderIds.includes(id))
  };
  await storage.update(KEY, sanitized);
  return sanitized;
}
