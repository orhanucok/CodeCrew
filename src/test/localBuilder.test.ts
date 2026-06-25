import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { buildVirtualChanges, normalizeRelative } from "../core/localBuilder";

test("local builder creates virtual output without changing disk", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codecrew-builder-"));
  const file = path.join(root, "file.ts");
  await writeFile(file, "const value = 1;");
  const changes = await buildVirtualChanges(root, {
    blocks: [{ kind: "replace", filePath: "file.ts", search: "value = 1", replace: "value = 2" }]
  });
  assert.equal(changes[0].afterContent, "const value = 2;");
  assert.ok(changes[0].beforeHash);
  assert.ok(changes[0].beforeMtimeMs);
  assert.equal(await readFile(file, "utf8"), "const value = 1;");
});

test("workspace traversal is rejected", () => {
  assert.throws(() => normalizeRelative("C:/workspace", "../outside.ts"), /inside/);
  assert.throws(() => normalizeRelative("C:/workspace", "."), /inside/);
});
