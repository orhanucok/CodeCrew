import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { prepareSafeChanges, SMALLER_PATCH_MESSAGE } from "../core/patchWorkflow";
import { PROTECTED_FILE_MESSAGE } from "../core/protectedFiles";

test("failed patch requests and uses one smaller patch retry", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codecrew-workflow-"));
  await writeFile(path.join(root, "file.ts"), "const value = 1;");
  let retries = 0;
  const changes = await prepareSafeChanges(
    root,
    "not a patch",
    "file.ts",
    async () => {
      retries++;
      return `<<<<<<< SEARCH
value = 1
=======
value = 2
>>>>>>> REPLACE`;
    }
  );
  assert.equal(retries, 1);
  assert.equal(changes[0].afterContent, "const value = 2;");
});

test("uncertain initial and retry patches both fail without writing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codecrew-workflow-"));
  const file = path.join(root, "file.ts");
  await writeFile(file, "const value = 1;");
  await assert.rejects(prepareSafeChanges(
    root,
    `<<<<<<< SEARCH
missing
=======
new
>>>>>>> REPLACE`,
    "file.ts",
    async () => `<<<<<<< SEARCH
still missing
=======
new
>>>>>>> REPLACE`
  ), /safely/);
  const { readFile } = await import("node:fs/promises");
  assert.equal(await readFile(file, "utf8"), "const value = 1;");
});

test("protected-file violations are rejected without a smaller-patch retry", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codecrew-workflow-"));
  let retries = 0;
  await assert.rejects(prepareSafeChanges(
    root,
    "CREATE FILE: .env\nSECRET=x",
    "file.ts",
    async () => {
      retries++;
      return "CREATE FILE: safe.ts\nexport {};";
    }
  ), new RegExp(PROTECTED_FILE_MESSAGE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(retries, 0);
});

test("smaller-patch progress message matches the V1 safety copy", () => {
  assert.equal(SMALLER_PATCH_MESSAGE, "Patch could not be applied safely. CodeCrew is preparing a smaller, safer patch.");
});
