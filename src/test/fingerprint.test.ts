import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fingerprintFile, fingerprintMatches } from "../core/fingerprint";

const selection = { startLine: 0, startCharacter: 0, endLine: 0, endCharacter: 0 };

test("fingerprint detects content, size, or mtime drift", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "codecrew-fingerprint-"));
  const file = path.join(root, "file.ts");
  await writeFile(file, "const value = 1;\n");
  const fingerprint = await fingerprintFile(file, "const value = 1;\n", false, selection);
  assert.equal(await fingerprintMatches(fingerprint), true);
  await new Promise((resolve) => setTimeout(resolve, 10));
  await writeFile(file, "const value = 20;\n");
  assert.equal(await fingerprintMatches(fingerprint), false);
});
