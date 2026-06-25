import { PatchBlock, VirtualFileChange, MatchKind } from "../types/patch";
import { assertFileIsNotProtected } from "./protectedFiles";

export class UnsafePatchError extends Error {}

export function applyBlocksToVirtualFiles(
  blocks: PatchBlock[],
  currentFiles: Map<string, string>
): VirtualFileChange[] {
  const working = new Map(currentFiles);
  const kinds = new Map<string, MatchKind[]>();
  const originals = new Map<string, string>();
  const created = new Set<string>();

  for (const block of blocks) {
    assertFileIsNotProtected(block.filePath);
    if (block.kind === "create") {
      if (working.has(block.filePath)) throw new UnsafePatchError(`Cannot create existing file: ${block.filePath}`);
      originals.set(block.filePath, "");
      working.set(block.filePath, block.content);
      kinds.set(block.filePath, ["create"]);
      created.add(block.filePath);
      continue;
    }
    const content = working.get(block.filePath);
    if (content === undefined) throw new UnsafePatchError(`Target file was not found: ${block.filePath}`);
    if (!originals.has(block.filePath)) originals.set(block.filePath, content);
    const result = replaceSafely(content, block.search, block.replace);
    working.set(block.filePath, result.content);
    kinds.set(block.filePath, [...(kinds.get(block.filePath) ?? []), result.kind]);
  }

  return [...originals.keys()].map((filePath) => ({
    filePath,
    beforeContent: originals.get(filePath)!,
    afterContent: working.get(filePath)!,
    matchKinds: kinds.get(filePath)!,
    isNew: created.has(filePath)
  }));
}

export function replaceSafely(content: string, search: string, replacement: string): { content: string; kind: MatchKind } {
  const safeReplacement = adaptLineEndings(replacement, content);
  const exact = uniqueIndex(content, search);
  if (exact >= 0) return { content: splice(content, exact, search.length, safeReplacement), kind: "exact" };

  const normalizedContent = content.replace(/\r\n/g, "\n");
  const normalizedSearch = search.replace(/\r\n/g, "\n");
  const lineEnding = uniqueIndex(normalizedContent, normalizedSearch);
  if (lineEnding >= 0) {
    const output = splice(normalizedContent, lineEnding, normalizedSearch.length, replacement.replace(/\r\n/g, "\n"));
    return { content: restoreLineEndings(output, content), kind: "line-ending" };
  }

  const whitespaceMatches = findWhitespaceMatches(content, search);
  if (whitespaceMatches.length === 1) {
    const match = whitespaceMatches[0];
    return { content: splice(content, match.start, match.length, safeReplacement), kind: "whitespace" };
  }
  if (whitespaceMatches.length > 1) throw new UnsafePatchError("Patch matched multiple locations.");

  const fuzzy = findFuzzyCandidate(content, search);
  if (!fuzzy) throw new UnsafePatchError("Patch could not be applied safely.");
  return { content: splice(content, fuzzy.start, fuzzy.length, safeReplacement), kind: "fuzzy" };
}

function uniqueIndex(content: string, search: string): number {
  const first = content.indexOf(search);
  if (first < 0) return -1;
  if (content.indexOf(search, first + 1) >= 0) {
    throw new UnsafePatchError("Patch matched multiple locations.");
  }
  return first;
}

function findWhitespaceMatches(content: string, search: string): Array<{ start: number; length: number }> {
  const pattern = search
    .split(/(\s+)/)
    .filter(Boolean)
    .map((part) => (/\s+/.test(part) ? "\\s+" : escapeRegExp(part)))
    .join("");
  if (!pattern) return [];
  return [...content.matchAll(new RegExp(pattern, "g"))].map((match) => ({ start: match.index!, length: match[0].length }));
}

function findFuzzyCandidate(content: string, search: string): { start: number; length: number } | undefined {
  const searchLines = search.replace(/\r\n/g, "\n").split("\n");
  if (searchLines.length < 3) return undefined;
  const records = splitLinesWithOffsets(content);
  const contentLines = records.map((record) => record.text);
  const candidates: Array<{ line: number; score: number }> = [];
  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    const candidate = contentLines.slice(i, i + searchLines.length).join("\n");
    const score = similarity(normalizeWhitespace(candidate), normalizeWhitespace(search));
    if (score >= 0.92 && contextMatches(contentLines, searchLines, i)) candidates.push({ line: i, score });
  }
  if (candidates.length !== 1) return undefined;
  const first = records[candidates[0].line];
  const last = records[candidates[0].line + searchLines.length - 1];
  const start = first.start;
  const length = last.start + last.text.length - first.start;
  return { start, length };
}

function splitLinesWithOffsets(content: string): Array<{ text: string; start: number }> {
  const records: Array<{ text: string; start: number }> = [];
  const pattern = /([^\r\n]*)(?:\r\n|\n|\r|$)/g;
  for (const match of content.matchAll(pattern)) {
    if (match[0] === "" && match.index === content.length) break;
    records.push({ text: match[1], start: match.index! });
  }
  return records;
}

function contextMatches(content: string[], search: string[], start: number): boolean {
  const meaningful = search.map((line) => line.trim()).filter(Boolean);
  const candidate = content.slice(start, start + search.length).map((line) => line.trim()).filter(Boolean);
  return meaningful.length > 1 && meaningful[0] === candidate[0] && meaningful.at(-1) === candidate.at(-1);
}

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  if (!max) return 1;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const old = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = old;
    }
  }
  return 1 - previous[b.length] / max;
}

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const adaptLineEndings = (value: string, source: string) =>
  source.includes("\r\n") ? value.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n") : value.replace(/\r\n/g, "\n");
const restoreLineEndings = (value: string, source: string) =>
  source.includes("\r\n") ? value.replace(/\n/g, "\r\n") : value;
const splice = (value: string, start: number, length: number, insert: string) =>
  value.slice(0, start) + insert + value.slice(start + length);
