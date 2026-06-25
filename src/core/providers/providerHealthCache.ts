import { AIProvider, ProviderHealthResult, ProviderModel } from "./types";

const TTL_MS = 5 * 60_000;
const cache = new Map<string, ProviderHealthResult>();

export async function cachedProviderHealth(
  provider: AIProvider,
  model: ProviderModel,
  force = false,
  now = Date.now()
): Promise<ProviderHealthResult> {
  const key = `${provider.id}:${model.id}`;
  const cached = cache.get(key);
  if (!force && cached && isFresh(cached, now)) return cached;
  const result = await provider.healthCheck(model);
  cache.set(key, result);
  return result;
}

export async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= values.length) return;
      results[index] = await mapper(values[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function clearProviderHealthCache(): void {
  cache.clear();
}

function isFresh(result: ProviderHealthResult, now: number): boolean {
  if (result.cooldownUntil && now < result.cooldownUntil) return true;
  return now - result.checkedAt < TTL_MS;
}
