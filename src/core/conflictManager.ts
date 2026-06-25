import { promises as fs } from "node:fs";
import { VirtualFileChange } from "../types/patch";
import { hashContent } from "./fingerprint";
import { resolveWorkspaceFile } from "./workspacePath";
import { FILE_CHANGED_MESSAGE } from "./conflictRecovery";

export class FileConflictError extends Error {
  constructor(readonly filePath: string) {
    super(FILE_CHANGED_MESSAGE);
  }
}

export async function assertChangesAreCurrent(root: string, changes: VirtualFileChange[]): Promise<void> {
  for (const change of changes) {
    const absolute = await resolveWorkspaceFile(root, change.filePath);
    if (change.isNew) {
      try {
        await fs.access(absolute);
        throw new FileConflictError(change.filePath);
      } catch (error) {
        if (error instanceof FileConflictError) throw error;
      }
      continue;
    }
    try {
      const [content, stat] = await Promise.all([fs.readFile(absolute, "utf8"), fs.stat(absolute)]);
      if (
        hashContent(content) !== (change.beforeHash ?? hashContent(change.beforeContent)) ||
        (change.beforeMtimeMs !== undefined && stat.mtimeMs !== change.beforeMtimeMs) ||
        (change.beforeSize !== undefined && stat.size !== change.beforeSize)
      ) {
        throw new FileConflictError(change.filePath);
      }
    } catch (error) {
      if (error instanceof FileConflictError) throw error;
      throw new FileConflictError(change.filePath);
    }
  }
}
