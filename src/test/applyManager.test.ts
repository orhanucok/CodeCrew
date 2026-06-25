import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { applyChangesTransactionally, FileWriter } from "../core/applyManager";
import { hashContent } from "../core/fingerprint";

test("real files remain untouched until apply is called", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codecrew-apply-"));
  const file = path.join(root, "file.ts");
  await writeFile(file, "before");
  const changes = [{ filePath: "file.ts", beforeContent: "before", afterContent: "after", matchKinds: ["exact" as const], isNew: false }];
  assert.equal(await readFile(file, "utf8"), "before");
  await applyChangesTransactionally(root, changes, undefined, false);
  assert.equal(await readFile(file, "utf8"), "after");
});

test("a partial multi-file write is rolled back", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codecrew-apply-"));
  const first = path.join(root, "first.ts");
  const second = path.join(root, "second.ts");
  await writeFile(first, "first-before");
  await writeFile(second, "second-before");
  let forwardWrites = 0;
  const writer: FileWriter = {
    mkdir: async () => undefined,
    write: async (filePath, content) => {
      if (content.endsWith("-after") && ++forwardWrites === 2) throw new Error("disk failure");
      await writeFile(filePath, content);
    },
    remove: async () => undefined
  };
  await assert.rejects(applyChangesTransactionally(root, [
    { filePath: "first.ts", beforeContent: "first-before", afterContent: "first-after", matchKinds: ["exact"], isNew: false },
    { filePath: "second.ts", beforeContent: "second-before", afterContent: "second-after", matchKinds: ["exact"], isNew: false }
  ], writer, false), /disk failure/);
  assert.equal(await readFile(first, "utf8"), "first-before");
  assert.equal(await readFile(second, "utf8"), "second-before");
});

test("a write that changes content and then throws is also rolled back", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codecrew-apply-"));
  const file = path.join(root, "file.ts");
  await writeFile(file, "before");
  let first = true;
  const writer: FileWriter = {
    mkdir: async () => undefined,
    write: async (filePath, content) => {
      await writeFile(filePath, content);
      if (first) {
        first = false;
        throw new Error("late disk failure");
      }
    },
    remove: async (filePath) => {
      const { rm } = await import("node:fs/promises");
      await rm(filePath, { force: true });
    }
  };
  await assert.rejects(applyChangesTransactionally(root, [{
    filePath: "file.ts",
    beforeContent: "before",
    afterContent: "after",
    matchKinds: ["exact"],
    isNew: false
  }], writer, false), /late disk failure/);
  assert.equal(await readFile(file, "utf8"), "before");
});

test("protected files are rejected before any write", async () => {
  let writes = 0;
  const writer: FileWriter = {
    mkdir: async () => undefined,
    write: async () => { writes++; },
    remove: async () => undefined
  };
  await assert.rejects(applyChangesTransactionally("C:/workspace", [{
    filePath: ".env",
    beforeContent: "",
    afterContent: "SECRET=x",
    matchKinds: ["create"],
    isNew: true
  }], writer, false), /Protected/);
  assert.equal(writes, 0);
});

test("Apply re-checks fingerprints and blocks a changed file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codecrew-apply-"));
  const file = path.join(root, "file.ts");
  await writeFile(file, "before");
  const info = await stat(file);
  await new Promise((resolve) => setTimeout(resolve, 20));
  await writeFile(file, "user changed it");
  await assert.rejects(applyChangesTransactionally(root, [{
    filePath: "file.ts",
    beforeContent: "before",
    afterContent: "after",
    beforeHash: hashContent("before"),
    beforeMtimeMs: info.mtimeMs,
    beforeSize: info.size,
    matchKinds: ["exact"],
    isNew: false
  }]), /changed while CodeCrew/);
  assert.equal(await readFile(file, "utf8"), "user changed it");
});
