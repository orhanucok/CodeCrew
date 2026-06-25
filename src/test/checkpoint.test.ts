import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { CheckpointManager, CheckpointTooLargeError, UNDO_BLOCKED_MESSAGE } from "../core/checkpointManager";

class MemoryStorage {
  private values = new Map<string, unknown>();
  get<T>(key: string, fallback: T): T { return (this.values.get(key) as T | undefined) ?? fallback; }
  async update<T>(key: string, value: T): Promise<void> { this.values.set(key, value); }
  seed<T>(key: string, value: T): void { this.values.set(key, value); }
  read<T>(key: string): T | undefined { return this.values.get(key) as T | undefined; }
}

test("checkpoint undo restores unchanged applied content", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codecrew-checkpoint-"));
  const file = path.join(root, "file.ts");
  await writeFile(file, "after");
  const manager = new CheckpointManager(new MemoryStorage());
  await manager.create("test", [{
    filePath: "file.ts",
    beforeContent: "before",
    afterContent: "after",
    matchKinds: ["exact"],
    isNew: false
  }]);
  assert.equal(await manager.canUndo(root), true);
  await manager.undo(root);
  assert.equal(await readFile(file, "utf8"), "before");
});

test("checkpoint stores before/after hashes and patch metadata", async () => {
  const manager = new CheckpointManager(new MemoryStorage());
  const checkpoint = await manager.create("metadata", [{
    filePath: "file.ts",
    beforeContent: "before",
    afterContent: "after",
    matchKinds: ["whitespace", "fuzzy"],
    isNew: false
  }]);
  assert.ok(checkpoint.files[0].beforeHash);
  assert.ok(checkpoint.files[0].afterHash);
  assert.deepEqual(checkpoint.files[0].matchKinds, ["whitespace", "fuzzy"]);
});

test("undo is blocked after a user edit", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codecrew-checkpoint-"));
  const file = path.join(root, "file.ts");
  await writeFile(file, "after");
  const manager = new CheckpointManager(new MemoryStorage());
  await manager.create("test", [{
    filePath: "file.ts",
    beforeContent: "before",
    afterContent: "after",
    matchKinds: ["exact"],
    isNew: false
  }]);
  await writeFile(file, "user edit");
  assert.equal(await manager.canUndo(root), false);
  await assert.rejects(manager.undo(root), new RegExp(UNDO_BLOCKED_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(await readFile(file, "utf8"), "user edit");
});

test("checkpoint storage keeps only the last 20 runs", async () => {
  const storage = new MemoryStorage();
  const manager = new CheckpointManager(storage);
  for (let index = 0; index < 25; index++) {
    await manager.create(`run ${index}`, [{
      filePath: "file.ts",
      beforeContent: `${index}`,
      afterContent: `${index + 1}`,
      matchKinds: ["exact"],
      isNew: false
    }]);
  }
  assert.equal(storage.read<unknown[]>("codecrew.checkpoints")?.length, 20);
  assert.equal(manager.latest()?.summary, "run 24");
});

test("expired checkpoints are unavailable", () => {
  const storage = new MemoryStorage();
  storage.seed("codecrew.checkpoints", [{
    id: "old",
    timestamp: Date.now() - 8 * 24 * 60 * 60 * 1000,
    summary: "old",
    files: []
  }]);
  const manager = new CheckpointManager(storage);
  assert.equal(manager.latest(), undefined);
});

test("snapshot storage stays within 50 MB", async () => {
  const storage = new MemoryStorage();
  const manager = new CheckpointManager(storage);
  const large = "x".repeat(14 * 1024 * 1024);
  await manager.create("first", [{ filePath: "a", beforeContent: large, afterContent: large, matchKinds: ["exact"], isNew: false }]);
  await manager.create("second", [{ filePath: "b", beforeContent: large, afterContent: large, matchKinds: ["exact"], isNew: false }]);
  assert.equal(storage.read<unknown[]>("codecrew.checkpoints")?.length, 1);
  assert.equal(manager.latest()?.summary, "second");
});

test("a single checkpoint over 50 MB blocks apply instead of silently losing undo", async () => {
  const manager = new CheckpointManager(new MemoryStorage());
  const tooLarge = "x".repeat(26 * 1024 * 1024);
  await assert.rejects(manager.create("too large", [{
    filePath: "large.ts",
    beforeContent: tooLarge,
    afterContent: tooLarge,
    matchKinds: ["exact"],
    isNew: false
  }]), CheckpointTooLargeError);
  assert.equal(manager.latest(), undefined);
});
