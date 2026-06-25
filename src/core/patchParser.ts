import { ParsedPatch, PatchBlock } from "../types/patch";
import { assertFileIsNotProtected } from "./protectedFiles";

export class PatchParseError extends Error {}

export function parsePatch(input: string, defaultFilePath?: string): ParsedPatch {
  const text = stripSingleCodeFence(input.trim());
  if (!text) throw new PatchParseError("Patch is empty.");
  if (/DELETE FILE:|>>>>>>> DELETE|^DELETE:/m.test(text)) throw new PatchParseError("Delete operations are disabled in V1.");

  const blocks: PatchBlock[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let index = 0;
  let pendingFile: string | undefined;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index++;
      continue;
    }
    if (line.startsWith("FILE:")) {
      pendingFile = requiredPath(line.slice("FILE:".length));
      index++;
      if (lines[index] !== "<<<<<<< SEARCH") throw new PatchParseError("FILE metadata must be followed by a SEARCH block.");
    }
    if (lines[index]?.startsWith("CREATE FILE:")) {
      const filePath = requiredPath(lines[index].slice("CREATE FILE:".length));
      assertAllowed(filePath);
      index++;
      const content: string[] = [];
      while (index < lines.length && !isBlockStart(lines[index])) content.push(lines[index++]);
      while (content.at(-1) === "") content.pop();
      if (content.length === 0) throw new PatchParseError("Created file content cannot be empty.");
      blocks.push({ kind: "create", filePath, content: content.join("\n") });
      pendingFile = undefined;
      continue;
    }
    if (lines[index] === "<<<<<<< SEARCH") {
      const filePath = pendingFile || defaultFilePath;
      if (!filePath) throw new PatchParseError("A target file path is required.");
      assertAllowed(filePath);
      index++;
      const search: string[] = [];
      while (index < lines.length && lines[index] !== "=======") search.push(lines[index++]);
      if (index >= lines.length) throw new PatchParseError("SEARCH block is missing its separator.");
      index++;
      const replace: string[] = [];
      while (index < lines.length && lines[index] !== ">>>>>>> REPLACE") replace.push(lines[index++]);
      if (index >= lines.length) throw new PatchParseError("Patch block is missing its REPLACE marker.");
      index++;
      if (search.length === 0 || search.every((value) => !value)) throw new PatchParseError("SEARCH content cannot be empty.");
      blocks.push({ kind: "replace", filePath, search: search.join("\n"), replace: replace.join("\n") });
      pendingFile = undefined;
      continue;
    }
    throw new PatchParseError(`Unexpected content in patch: ${line.slice(0, 80)}`);
  }
  if (pendingFile) throw new PatchParseError("FILE metadata is missing a patch block.");
  if (blocks.length === 0) throw new PatchParseError("Invalid Search/Replace patch format.");
  return { blocks };
}

function stripSingleCodeFence(text: string): string {
  const match = text.match(/^```(?:diff|patch|text)?\s*\n([\s\S]*?)\n```$/);
  return match ? match[1].trim() : text;
}

function isBlockStart(line: string): boolean {
  return line.startsWith("CREATE FILE:") || line.startsWith("FILE:") || line === "<<<<<<< SEARCH";
}

function requiredPath(value: string): string {
  const result = value.trim();
  if (!result) throw new PatchParseError("A target file path is required.");
  return result;
}

function assertAllowed(filePath: string): void {
  assertFileIsNotProtected(filePath);
}
