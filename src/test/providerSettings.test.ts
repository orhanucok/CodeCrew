import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultProviderSettings,
  loadProviderSettings,
  providerPriority,
  saveProviderSettings
} from "../core/providers/providerSettings";

class MemoryStorage {
  private values = new Map<string, unknown>();
  get<T>(key: string, fallback: T): T { return (this.values.get(key) as T | undefined) ?? fallback; }
  async update<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
}

test("all supported providers are enabled by default but skipped when unconfigured", () => {
  assert.deepEqual(defaultProviderSettings.enabledProviderIds, providerPriority);
  assert.deepEqual(loadProviderSettings(new MemoryStorage()), defaultProviderSettings);
});

test("provider settings store only known provider identifiers", async () => {
  const storage = new MemoryStorage();
  const saved = await saveProviderSettings(storage, {
    enabledProviderIds: ["gemini", "groq", "unknown" as never]
  });
  assert.deepEqual(saved.enabledProviderIds, ["gemini", "groq"]);
});
