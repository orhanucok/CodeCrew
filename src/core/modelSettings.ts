import { ModelRuntimeStats, ModelSettings, ModelTask } from "../types/model";

const SETTINGS_KEY = "codecrew.modelSettings";
const STATS_KEY = "codecrew.modelStats";

export const defaultModelSettings: ModelSettings = {
  autoMode: true,
  manualPreferredModelsEnabled: false,
  selectedFreeModelIds: [],
  allowAutomaticFreeFallback: true,
  paidFallbackEnabled: false,
  selectedPaidModelIds: []
};

export interface ModelStateStorage {
  get<T>(key: string, fallback: T): T;
  update<T>(key: string, value: T): Thenable<void>;
}

export function loadModelSettings(storage: ModelStateStorage): ModelSettings {
  return sanitizeModelSettings(storage.get<ModelSettings>(SETTINGS_KEY, defaultModelSettings));
}

export async function saveModelSettings(storage: ModelStateStorage, settings: ModelSettings): Promise<ModelSettings> {
  const sanitized = sanitizeModelSettings(settings);
  await storage.update(SETTINGS_KEY, sanitized);
  return sanitized;
}

export async function resetModelSettings(storage: ModelStateStorage): Promise<ModelSettings> {
  return saveModelSettings(storage, defaultModelSettings);
}

export function loadModelStats(storage: ModelStateStorage): Record<string, ModelRuntimeStats> {
  return storage.get<Record<string, ModelRuntimeStats>>(STATS_KEY, {});
}

export async function recordModelAttempt(
  storage: ModelStateStorage,
  modelId: string,
  outcome: "success" | "failure" | "invalidPatch",
  latencyMs: number,
  task: ModelTask = "patch"
): Promise<void> {
  const all = loadModelStats(storage);
  const previous = all[modelId] ?? {
    modelId,
    attempts: 0,
    failures: 0,
    invalidPatchResponses: 0,
    successfulPatches: 0
  };
  const attempts = previous.attempts + 1;
  all[modelId] = {
    ...previous,
    attempts,
    failures: previous.failures + (outcome === "failure" ? 1 : 0),
    invalidPatchResponses: previous.invalidPatchResponses + (task === "patch" && outcome === "invalidPatch" ? 1 : 0),
    successfulPatches: previous.successfulPatches + (task === "patch" && outcome === "success" ? 1 : 0),
    averageLatencyMs: Math.round(
      (((previous.averageLatencyMs ?? latencyMs) * previous.attempts) + latencyMs) / attempts
    )
  };
  await storage.update(STATS_KEY, all);
}

export function sanitizeModelSettings(value: Partial<ModelSettings> | undefined): ModelSettings {
  const manualPreferredModelsEnabled = value?.manualPreferredModelsEnabled === true;
  return {
    autoMode: !manualPreferredModelsEnabled,
    manualPreferredModelsEnabled,
    selectedFreeModelIds: uniqueStrings(value?.selectedFreeModelIds),
    allowAutomaticFreeFallback: value?.allowAutomaticFreeFallback !== false,
    paidFallbackEnabled: value?.paidFallbackEnabled === true,
    selectedPaidModelIds: uniqueStrings(value?.selectedPaidModelIds)
  };
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())))];
}
