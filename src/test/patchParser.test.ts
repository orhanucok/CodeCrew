import test from "node:test";
import assert from "node:assert/strict";
import { parsePatch, PatchParseError } from "../core/patchParser";

test("parses one and multiple Search/Replace blocks", () => {
  const parsed = parsePatch(`FILE: src/a.ts
<<<<<<< SEARCH
const a = 1;
=======
const a = 2;
>>>>>>> REPLACE
FILE: src/b.ts
<<<<<<< SEARCH
const b = 1;
=======
const b = 2;
>>>>>>> REPLACE`);
  assert.equal(parsed.blocks.length, 2);
});

test("parses CREATE FILE", () => {
  const parsed = parsePatch("CREATE FILE: src/new.ts\nexport const value = 1;");
  assert.equal(parsed.blocks[0].kind, "create");
});

test("parses fenced patches and multiple CREATE FILE blocks", () => {
  const parsed = parsePatch(`\`\`\`diff
CREATE FILE: src/a.ts
export const a = 1;
CREATE FILE: src/b.ts
export const b = 2;
\`\`\``);
  assert.equal(parsed.blocks.length, 2);
});

test("uses the default target path when FILE metadata is absent", () => {
  const parsed = parsePatch(`<<<<<<< SEARCH
old
=======
new
>>>>>>> REPLACE`, "src/default.ts");
  assert.equal(parsed.blocks[0].filePath, "src/default.ts");
});

test("rejects empty, malformed, delete, and protected patches", () => {
  assert.throws(() => parsePatch(""), PatchParseError);
  assert.throws(() => parsePatch("hello"), PatchParseError);
  assert.throws(() => parsePatch("DELETE FILE: src/a.ts"), /disabled/);
  assert.throws(() => parsePatch("CREATE FILE: .env\nSECRET=x"), /protected/);
  assert.throws(() => parsePatch("CREATE FILE: .env.local\nSECRET=x"), /protected/);
  assert.throws(() => parsePatch("CREATE FILE: .env.production\nSECRET=x"), /protected/);
  assert.throws(() => parsePatch("CREATE FILE: node_modules/x.js\nx"), /protected/);
  assert.throws(() => parsePatch("Here is the patch:\n<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE", "src/a.ts"), /Unexpected/);
  assert.throws(() => parsePatch("FILE: src/a.ts"), /followed/);
  assert.throws(() => parsePatch("<<<<<<< SEARCH\nold\nnew", "src/a.ts"), /separator/);
  assert.throws(() => parsePatch("<<<<<<< SEARCH\nold\n=======\nnew", "src/a.ts"), /REPLACE/);
  assert.throws(() => parsePatch("CREATE FILE: package-lock.json\n{}"), /protected/);
  assert.throws(() => parsePatch("CREATE FILE: pnpm-lock.yaml\nx"), /protected/);
  assert.throws(() => parsePatch("CREATE FILE: yarn.lock\nx"), /protected/);
  assert.throws(() => parsePatch("CREATE FILE: .git/config\nx"), /protected/);
  assert.throws(() => parsePatch("CREATE FILE: .ENV\nSECRET=x"), /Protected files cannot be modified in V1/);
  assert.throws(() => parsePatch("CREATE FILE: NODE_MODULES/x.js\nx"), /Protected files cannot be modified in V1/);
});
