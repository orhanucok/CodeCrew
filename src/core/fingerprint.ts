import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { FileFingerprint } from "../types/context";

export function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export async function fingerprintFile(
  filePath: string,
  content: string,
  dirty: boolean,
  selection: FileFingerprint["selection"]
): Promise<FileFingerprint> {
  const stat = await fs.stat(filePath);
  return { filePath, contentHash: hashContent(content), mtimeMs: stat.mtimeMs, size: stat.size, dirty, selection };
}

export async function fingerprintMatches(expected: FileFingerprint): Promise<boolean> {
  try {
    const [content, stat] = await Promise.all([fs.readFile(expected.filePath, "utf8"), fs.stat(expected.filePath)]);
    return hashContent(content) === expected.contentHash && stat.mtimeMs === expected.mtimeMs && stat.size === expected.size;
  } catch {
    return false;
  }
}
