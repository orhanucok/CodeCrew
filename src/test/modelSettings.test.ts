import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultModelSettings,
  loadModelSettings,
  resetModelSettings,
  saveModelSettings
} from "../core/modelSettings";

class MemoryStorage {
  private values = new Map<string, unknown>();
  get<T>(key: string, fallback: T): T { return (this.values.get(key) as T | undefined) ?? fallback; }
  async update<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
}

test("model settings default to Auto ON and paid fallback OFF", () => {
  const settings = loadModelSettings(new MemoryStorage());
  assert.deepEqual(settings, defaultModelSettings);
  assert.equal(settings.autoMode, true);
  assert.equal(settings.paidFallbackEnabled, false);
});

test("manual mode and selected lists are stored without API key data", async () => {
  const storage = new MemoryStorage();
  await saveModelSettings(storage, {
    ...defaultModelSettings,
    autoMode: false,
    manualPreferredModelsEnabled: true,
    selectedFreeModelIds: ["a:free", "a:free"],
    allowAutomaticFreeFallback: false
  });
  const settings = loadModelSettings(storage);
  assert.equal(settings.autoMode, false);
  assert.equal(settings.manualPreferredModelsEnabled, true);
  assert.deepEqual(settings.selectedFreeModelIds, ["a:free"]);
  assert.equal("apiKey" in settings, false);
});

test("reset restores recommended defaults", async () => {
  const storage = new MemoryStorage();
  await saveModelSettings(storage, { ...defaultModelSettings, paidFallbackEnabled: true });
  const reset = await resetModelSettings(storage);
  assert.deepEqual(reset, defaultModelSettings);
});
