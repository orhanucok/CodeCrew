import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as path from "node:path";

test("manifest exposes all required commands in editor and command palette", async () => {
  const pkg = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as {
    contributes: {
      commands: Array<{ command: string }>;
      menus: { "editor/context": Array<{ command: string }>; "problems/context": Array<{ command: string }> };
    };
  };
  const required = ["codecrew.fix", "codecrew.explain", "codecrew.improve", "codecrew.addTypes", "codecrew.writeTests"];
  assert.deepEqual(required.filter((command) => !pkg.contributes.commands.some((item) => item.command === command)), []);
  assert.deepEqual(required.filter((command) => !pkg.contributes.menus["editor/context"].some((item) => item.command === command)), []);
  assert.ok(pkg.contributes.menus["problems/context"].some((item) => item.command === "codecrew.fix"));
  const undo = pkg.contributes.commands.find((item) => item.command === "codecrew.undo") as { enablement?: string } | undefined;
  assert.equal(undo?.enablement, "codecrew.canUndo");
  assert.equal("configuration" in pkg.contributes, false);
  assert.ok(pkg.contributes.commands.some((item) => item.command === "codecrew.modelSettings"));
  assert.ok(pkg.contributes.commands.some((item) => item.command === "codecrew.providerSettings"));
});
