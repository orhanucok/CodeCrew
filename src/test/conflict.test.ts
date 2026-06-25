import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { assertChangesAreCurrent, FileConflictError } from "../core/conflictManager";
import { hashContent } from "../core/fingerprint";

async function fixture(content = "before") {
  const root = await mkdtemp(path.join(tmpdir(), "codecrew-conflict-"));
  const filePath = "file.ts";
  await writeFile(path.join(root, filePath), content);
  const info = await stat(path.join(root, filePath));
  return {
    root,
    absolute: path.join(root, filePath),
    change: {
      filePath,
      beforeContent: content,
      afterContent: "after",
      beforeHash: hashContent(content),
      beforeMtimeMs: info.mtimeMs,
      beforeSize: info.size,
      matchKinds: ["exact" as const],
      isNew: false
    }
  };
}

test("unchanged fingerprints remain valid", async () => {
  const value = await fixture();
  await assert.doesNotReject(assertChangesAreCurrent(value.root, [value.change]));
});

test("hash and size changes block apply", async () => {
  const value = await fixture();
  await writeFile(value.absolute, "different content");
  await assert.rejects(assertChangesAreCurrent(value.root, [value.change]), FileConflictError);
});

test("mtime changes block apply even when content and size match", async () => {
  const value = await fixture("same");
  await new Promise((resolve) => setTimeout(resolve, 20));
  await writeFile(value.absolute, "same");
  await assert.rejects(assertChangesAreCurrent(value.root, [value.change]), FileConflictError);
});

test("a new-file collision blocks apply", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codecrew-conflict-"));
  await writeFile(path.join(root, "new.ts"), "user file");
  await assert.rejects(assertChangesAreCurrent(root, [{
    filePath: "new.ts",
    beforeContent: "",
    afterContent: "generated",
    matchKinds: ["create"],
    isNew: true
  }]), FileConflictError);
});
