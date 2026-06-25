export type HealthState =
  | "Ready"
  | "Slow"
  | "Busy"
  | "RateLimited"
  | "Failed"
  | "Cooldown"
  | "Unavailable"
  | "Untested";

export type CapabilityLevel = "high" | "medium" | "low" | "unknown";
export type ModelTask = "patch" | "explain" | "tests";

export interface ModelCandidate {
  id: string;
  displayName: string;
  provider: "openrouter";
  isFree: boolean;
  isPaid: boolean;
  tags: string[];
  knownCodingCapability: CapabilityLevel;
  knownReasoningCapability: CapabilityLevel;
  contextWindow?: number;
  defaultEnabled: boolean;
  recommendedForPatchGeneration: boolean;
  recommendedForExplain: boolean;
  recommendedForTests: boolean;
}

export interface ModelSettings {
  autoMode: boolean;
  manualPreferredModelsEnabled: boolean;
  selectedFreeModelIds: string[];
  allowAutomaticFreeFallback: boolean;
  paidFallbackEnabled: boolean;
  selectedPaidModelIds: string[];
}

export interface ModelHealth {
  modelId: string;
  state: HealthState;
  checkedAt?: number;
  latencyMs?: number;
  retryAfterMs?: number;
  cooldownUntil?: number;
}

export interface ModelRuntimeStats {
  modelId: string;
  attempts: number;
  failures: number;
  invalidPatchResponses: number;
  successfulPatches: number;
  averageLatencyMs?: number;
}

export interface ScoredModel {
  candidate: ModelCandidate;
  health: ModelHealth;
  score: number;
  badge: "Recommended" | "Good fallback" | "Busy" | "Not available" | "Paid";
}

export interface ModelChoice {
  primary: string;
  fallbacks: string[];
}
