export type ProviderId =
  | "openrouter"
  | "gemini"
  | "cerebras"
  | "groq"
  | "github-models"
  | "mistral"
  | "cloudflare-workers-ai"
  | "huggingface";

export type ModelUseCase = "patch" | "explain" | "planning" | "review" | "tests" | "general";

export type ProviderHealthStatus =
  | "Ready"
  | "Slow"
  | "RateLimited"
  | "Cooldown"
  | "Unavailable"
  | "InvalidKey"
  | "QuotaExceeded"
  | "InvalidPatchFormat"
  | "Untested";

export interface ProviderModel {
  providerId: ProviderId;
  id: string;
  displayName: string;
  isFreeTier: boolean;
  isPaid: boolean;
  supportsCoding: boolean;
  supportsReasoning: boolean;
  supportsStructuredOutput?: boolean;
  supportsLongContext?: boolean;
  contextWindow?: number;
  recommendedUseCases: ModelUseCase[];
}

export interface ProviderMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ProviderCallOptions {
  model: string;
  messages: ProviderMessage[];
  temperature?: number;
  timeoutMs: number;
  useCase: ModelUseCase;
}

export interface ProviderCallResult {
  text: string;
  providerId: ProviderId;
  model: string;
  raw?: unknown;
}

export interface ProviderHealthResult {
  status: ProviderHealthStatus;
  checkedAt: number;
  latencyMs?: number;
  retryAfterMs?: number;
  cooldownUntil?: number;
}

export interface AIProvider {
  id: ProviderId;
  displayName: string;
  priority: number;
  isConfigured(): Promise<boolean>;
  listModels(): Promise<ProviderModel[]>;
  healthCheck(model: ProviderModel): Promise<ProviderHealthResult>;
  callModel(options: ProviderCallOptions): Promise<ProviderCallResult>;
  classifyError(error: unknown): ProviderHealthStatus;
}

export interface ProviderSettings {
  enabledProviderIds: ProviderId[];
}
