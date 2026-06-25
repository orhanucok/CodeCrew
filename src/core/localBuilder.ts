import { promises as fs } from "node:fs";
import * as path from "node:path";
import { ParsedPatch, VirtualFileChange } from "../types/patch";
import { applyBlocksToVirtualFiles } from "./patchEngine";
import { assertFileIsNotProtected } from "./protectedFiles";
import { hashContent } from "./fingerprint";
import { normalizeWorkspaceRelative, resolveWorkspaceFile } from "./workspacePath";

export async function buildVirtualChanges(root: string, patch: ParsedPatch): Promise<VirtualFileChange[]> {
  const files = new Map<string, string>();
  const stats = new Map<string, { hash: string; mtimeMs: number; size: number }>();
  for (const block of patch.blocks) {
    const relative = normalizeWorkspaceRelative(root, block.filePath);
    block.filePath = relative;
    assertFileIsNotProtected(relative);
    if (block.kind === "replace" && !files.has(relative)) {
      const absolute = await resolveWorkspaceFile(root, relative);
      const [content, stat] = await Promise.all([fs.readFile(absolute, "utf8"), fs.stat(absolute)]);
      files.set(relative, content);
      stats.set(relative, { hash: hashContent(content), mtimeMs: stat.mtimeMs, size: stat.size });
    }
  }
  return applyBlocksToVirtualFiles(patch.blocks, files).map((change) => {
    const stat = stats.get(change.filePath);
    return {
      ...change,
      beforeHash: stat?.hash,
      beforeMtimeMs: stat?.mtimeMs,
      beforeSize: stat?.size
    };
  });
}

export function normalizeRelative(root: string, target: string): string {
  return normalizeWorkspaceRelative(root, target);
}
