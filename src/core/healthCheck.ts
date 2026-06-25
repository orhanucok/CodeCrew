import { callModel, ModelCall, OpenRouterError } from "./openrouterClient";
import { ModelHealth } from "../types/model";
import { createHash } from "node:crypto";

export const HEALTH_CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, ModelHealth>();

type HealthCaller = (input: ModelCall) => Promise<string>;

export async function healthCheck(
  apiKey: string,
  model: string,
  options: { force?: boolean; now?: number; call?: HealthCaller; clock?: () => number } = {}
): Promise<ModelHealth> {
  const clock = options.clock ?? Date.now;
  const now = options.now ?? clock();
  const key = healthKey(apiKey, model);
  const cached = cache.get(key);
  if (!options.force && cached && isFresh(cached, now)) return cached;
  const started = now;
  const caller = options.call ?? callModel;
  let result: ModelHealth;
  try {
    await caller({
      apiKey,
      model,
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
      temperature: 0,
      timeoutMs: 10_000
    });
    const latencyMs = Math.max(0, clock() - started);
    result = {
      modelId: model,
      state: latencyMs > 6_000 ? "Slow" : "Ready",
      checkedAt: now,
      latencyMs
    };
  } catch (error) {
    if (error instanceof OpenRouterError && (error.status === 401 || error.status === 402)) throw error;
    result = healthFromError(model, error, now);
  }
  cache.set(key, result);
  return result;
}

export async function refreshModelHealth(
  apiKey: string,
  modelIds: string[],
  call?: HealthCaller
): Promise<Record<string, ModelHealth>> {
  const results = await Promise.all(modelIds.map((model) => healthCheck(apiKey, model, { force: true, call })));
  return Object.fromEntries(results.map((result) => [result.modelId, result]));
}

export function getCachedHealth(apiKey: string, model: string, now = Date.now()): ModelHealth | undefined {
  const value = cache.get(healthKey(apiKey, model));
  return value && isFresh(value, now) ? value : undefined;
}

export function clearHealthCache(): void {
  cache.clear();
}

export function healthFromError(modelId: string, error: unknown, now = Date.now()): ModelHealth {
  const status = (error as { status?: number }).status;
  const retryAfterMs = (error as { retryAfterMs?: number }).retryAfterMs;
  if (status === 429) {
    return {
      modelId,
      state: retryAfterMs ? "Cooldown" : "RateLimited",
      checkedAt: now,
      retryAfterMs,
      cooldownUntil: retryAfterMs ? now + retryAfterMs : undefined
    };
  }
  if (status === 503) {
    return {
      modelId,
      state: retryAfterMs ? "Cooldown" : "Busy",
      checkedAt: now,
      retryAfterMs,
      cooldownUntil: retryAfterMs ? now + retryAfterMs : undefined
    };
  }
  if (status === 408) return { modelId, state: "Failed", checkedAt: now };
  if (status === 500 || status === 502) return { modelId, state: "Unavailable", checkedAt: now };
  return { modelId, state: "Failed", checkedAt: now };
}

function isFresh(value: ModelHealth, now: number): boolean {
  if (value.cooldownUntil && now < value.cooldownUntil) return true;
  return Boolean(value.checkedAt && now - value.checkedAt < HEALTH_CACHE_TTL_MS);
}

function healthKey(apiKey: string, model: string): string {
  return `${createHash("sha256").update(apiKey).digest("hex").slice(0, 12)}:${model}`;
}
