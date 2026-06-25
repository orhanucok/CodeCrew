import { promises as fs } from "node:fs";
import * as path from "node:path";
import { VirtualFileChange } from "../types/patch";
import { assertFileIsNotProtected } from "./protectedFiles";
import { assertChangesAreCurrent } from "./conflictManager";
import { resolveWorkspaceFile } from "./workspacePath";

export interface FileWriter {
  mkdir(directory: string): Promise<unknown>;
  write(filePath: string, content: string): Promise<unknown>;
  remove(filePath: string): Promise<unknown>;
}

const diskWriter: FileWriter = {
  mkdir: (directory) => fs.mkdir(directory, { recursive: true }),
  write: (filePath, content) => fs.writeFile(filePath, content, "utf8"),
  remove: (filePath) => fs.unlink(filePath)
};

export async function applyChangesTransactionally(
  root: string,
  changes: VirtualFileChange[],
  writer: FileWriter = diskWriter,
  recheck = true
): Promise<void> {
  for (const change of changes) assertFileIsNotProtected(change.filePath);
  if (recheck) await assertChangesAreCurrent(root, changes);
  const attempted: Array<{ change: VirtualFileChange; absolute: string }> = [];
  try {
    for (const change of changes) {
      if (recheck) await assertChangesAreCurrent(root, [change]);
      const absolute = await resolveWorkspaceFile(root, change.filePath);
      await writer.mkdir(path.dirname(absolute));
      attempted.push({ change, absolute });
      await writer.write(absolute, change.afterContent);
    }
  } catch (error) {
    const rollbackFailures: string[] = [];
    for (const { change, absolute } of attempted.reverse()) {
      try {
        if (change.isNew) await writer.remove(absolute);
        else await writer.write(absolute, change.beforeContent);
      } catch (rollbackError) {
        if (!change.isNew || (rollbackError as NodeJS.ErrnoException).code !== "ENOENT") {
          rollbackFailures.push(change.filePath);
        }
      }
    }
    if (rollbackFailures.length) {
      throw new Error(`CodeCrew could not complete the change and rollback also failed for: ${rollbackFailures.join(", ")}.`);
    }
    throw error;
  }
}
