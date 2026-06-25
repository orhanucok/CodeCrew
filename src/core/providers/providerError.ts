import { parseRetryAfter } from "../openrouterClient";
import { ProviderHealthStatus } from "./types";

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number
  ) {
    super(message);
  }
}

export function providerErrorFromResponse(response: Response): ProviderError {
  return new ProviderError(
    "AI provider request failed.",
    response.status,
    parseRetryAfter(response.headers.get("retry-after"))
  );
}

export function classifyProviderError(error: unknown): ProviderHealthStatus {
  const status = (error as { status?: number }).status;
  if (status === 401 || status === 403) return "InvalidKey";
  if (status === 402) return "QuotaExceeded";
  if (status === 429) return "RateLimited";
  if (status === 408 || (error as Error)?.name === "AbortError") return "Slow";
  if (status && status >= 500) return "Unavailable";
  return "Unavailable";
}
