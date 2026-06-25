import test from "node:test";
import assert from "node:assert/strict";
import { replaceSafely, UnsafePatchError, applyBlocksToVirtualFiles } from "../core/patchEngine";

test("exact replacement is unique and virtual", () => {
  const original = "const value = 1;\n";
  const result = replaceSafely(original, "value = 1", "value = 2");
  assert.equal(result.content, "const value = 2;\n");
  assert.equal(original, "const value = 1;\n");
  assert.equal(result.kind, "exact");
});

test("supports line-ending and whitespace tolerance", () => {
  assert.equal(replaceSafely("a\r\nb\r\n", "a\nb", "x\ny").kind, "line-ending");
  assert.equal(replaceSafely("const  x = 1;", "const x = 1;", "const x = 2;").kind, "whitespace");
});

test("supports indentation tolerance", () => {
  const result = replaceSafely("if (ready) {\n    run();\n}", "if (ready) {\n  run();\n}", "if (ready) {\n  await run();\n}");
  assert.equal(result.kind, "whitespace");
  assert.match(result.content, /await run/);
});

test("duplicate matches reject", () => {
  assert.throws(() => replaceSafely("x\nx\n", "x", "y"), UnsafePatchError);
});

test("overlapping duplicate matches reject", () => {
  assert.throws(() => replaceSafely("aaa", "aa", "x"), UnsafePatchError);
});

test("low confidence fuzzy patch rejects", () => {
  assert.throws(() => replaceSafely("alpha\nbeta\ngamma\n", "alpha\nCOMPLETELY DIFFERENT\ngamma", "x"), /safely/);
});

test("high-confidence fuzzy patch applies only with unique surrounding context", () => {
  const content = "function demo() {\n  const message = 'hello world';\n  return message;\n}\n";
  const search = "function demo() {\n  const message = 'hello worle';\n  return message;\n}";
  const result = replaceSafely(content, search, "function demo() {\n  return 'updated';\n}");
  assert.equal(result.kind, "fuzzy");
});

test("fuzzy matching preserves CRLF offsets and line endings", () => {
  const content = "header\r\nfunction demo() {\r\n  const message = 'hello world';\r\n  return message;\r\n}\r\nfooter\r\n";
  const search = "function demo() {\n  const message = 'hello worle';\n  return message;\n}";
  const result = replaceSafely(content, search, "function demo() {\n  return 'updated';\n}");
  assert.equal(result.kind, "fuzzy");
  assert.equal(result.content, "header\r\nfunction demo() {\r\n  return 'updated';\r\n}\r\nfooter\r\n");
});

test("fuzzy matching rejects multiple candidates", () => {
  const block = "function demo() {\n  const message = 'hello world';\n  return message;\n}\n";
  const search = "function demo() {\n  const message = 'hello worle';\n  return message;\n}";
  assert.throws(() => replaceSafely(`${block}\n${block}`, search, "replacement"), /safely/);
});

test("protected files are never applied", () => {
  assert.throws(() => applyBlocksToVirtualFiles(
    [{ kind: "create", filePath: "package-lock.json", content: "{}" }],
    new Map()
  ), /Protected/);
});
