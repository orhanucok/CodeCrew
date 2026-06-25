import test from "node:test";
import assert from "node:assert/strict";
import { buildPrompt } from "../core/promptBuilder";
import { TaskContext } from "../types/context";

const base: TaskContext = {
  instruction: "Fix it",
  command: "fix",
  filePath: "src/file.ts",
  fileContent: "const value = 1;",
  selectedCode: "value = 1",
  selectedRange: { startLine: 0, startCharacter: 6, endLine: 0, endCharacter: 15 },
  problems: ["Type mismatch"],
  projectSummary: "TypeScript; Safe Mode ON",
  styleNote: "Use TypeScript.",
  fingerprint: {
    filePath: "C:/workspace/src/file.ts",
    contentHash: "hash",
    mtimeMs: 1,
    size: 16,
    dirty: false,
    selection: { startLine: 0, startCharacter: 6, endLine: 0, endCharacter: 15 }
  }
};

test("code-changing prompt includes minimal context and patch-only safety rules", () => {
  const prompt = buildPrompt(base);
  assert.match(prompt, /Selected range: 1:7-1:16/);
  assert.match(prompt, /value = 1/);
  assert.match(prompt, /Type mismatch/);
  assert.match(prompt, /Return only a Search\/Replace patch/);
  assert.match(prompt, /Never touch \.env files/);
});

test("Explain requests explanation only and no patch", () => {
  const prompt = buildPrompt({ ...base, command: "explain" });
  assert.match(prompt, /Do not return a patch/);
});
