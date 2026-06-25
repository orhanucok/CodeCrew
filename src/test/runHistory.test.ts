import test from "node:test";
import assert from "node:assert/strict";
import { RunHistory } from "../core/runHistory";

class MemoryStorage {
  private values = new Map<string, unknown>();
  get<T>(key: string, fallback: T): T { return (this.values.get(key) as T | undefined) ?? fallback; }
  async update<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
}

test("history is created after apply and limited to 20 records", async () => {
  const history = new RunHistory(new MemoryStorage());
  for (let index = 0; index < 25; index++) {
    await history.add({
      id: `${index}`,
      timestamp: index,
      summary: `run ${index}`,
      changedFiles: ["file.ts"],
      risk: "Low",
      cost: 0
    });
  }
  assert.equal(history.list().length, 20);
  assert.equal(history.list()[0].summary, "run 24");
});
