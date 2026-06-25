import { promises as fs } from "node:fs";
import * as path from "node:path";
import { Checkpoint } from "../types/checkpoint";
import { VirtualFileChange } from "../types/patch";
import { hashContent } from "./fingerprint";
import { resolveWorkspaceFile } from "./workspacePath";

const KEY = "codecrew.checkpoints";
const MAX_ITEMS = 20;
const MAX_BYTES = 50 * 1024 * 1024;
const MAX_AGE = 7 * 24 * 60 * 60 * 1000;
export const UNDO_BLOCKED_MESSAGE =
  "This file changed after CodeCrew applied the patch. Undo is blocked to avoid overwriting your work.";

export class CheckpointTooLargeError extends Error {
  constructor() {
    super("CodeCrew cannot apply this change because its safety checkpoint exceeds the 50 MB V1 limit.");
  }
}

interface StateStorage {
  get<T>(key: string, fallback: T): T;
  update<T>(key: string, value: T): Thenable<void>;
}

export class CheckpointManager {
  constructor(private readonly storage: StateStorage) {}

  async create(summary: string, changes: VirtualFileChange[]): Promise<Checkpoint> {
    const checkpoint: Checkpoint = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      timestamp: Date.now(),
      summary,
      files: changes.map((change) => ({
        filePath: change.filePath,
        beforeContent: change.beforeContent,
        afterContent: change.afterContent,
        beforeHash: hashContent(change.beforeContent),
        afterHash: hashContent(change.afterContent),
        existedBefore: !change.isNew,
        matchKinds: [...change.matchKinds]
      }))
    };
    if (checkpointSize(checkpoint) > MAX_BYTES) throw new CheckpointTooLargeError();
    const current = this.cleanup([checkpoint, ...this.storage.get<Checkpoint[]>(KEY, [])]);
    await this.storage.update(KEY, current);
    return checkpoint;
  }

  latest(): Checkpoint | undefined {
    return this.cleanup(this.storage.get<Checkpoint[]>(KEY, []))[0];
  }

  async remove(id: string): Promise<void> {
    await this.storage.update(KEY, this.storage.get<Checkpoint[]>(KEY, []).filter((item) => item.id !== id));
  }

  async canUndo(root: string, checkpoint = this.latest()): Promise<boolean> {
    if (!checkpoint) return false;
    for (const file of checkpoint.files) {
      try {
        const absolute = await resolveWorkspaceFile(root, file.filePath);
        const current = await fs.readFile(absolute, "utf8");
        if (hashContent(current) !== file.afterHash) return false;
      } catch {
        return false;
      }
    }
    return true;
  }

  async undo(root: string): Promise<void> {
    const checkpoint = this.latest();
    if (!checkpoint || !(await this.canUndo(root, checkpoint))) {
      throw new Error(UNDO_BLOCKED_MESSAGE);
    }
    const attempted: Array<{ file: Checkpoint["files"][number]; absolute: string }> = [];
    try {
      for (const file of checkpoint.files) {
        const absolute = await resolveWorkspaceFile(root, file.filePath);
        const current = await fs.readFile(absolute, "utf8");
        if (hashContent(current) !== file.afterHash) {
          throw new Error(UNDO_BLOCKED_MESSAGE);
        }
        attempted.push({ file, absolute });
        if (file.existedBefore) {
          await fs.mkdir(path.dirname(absolute), { recursive: true });
          await fs.writeFile(absolute, file.beforeContent, "utf8");
        } else {
          await fs.unlink(absolute);
        }
      }
    } catch (error) {
      const rollbackFailures: string[] = [];
      for (const { file, absolute } of attempted.reverse()) {
        try {
          await fs.mkdir(path.dirname(absolute), { recursive: true });
          await fs.writeFile(absolute, file.afterContent, "utf8");
        } catch {
          rollbackFailures.push(file.filePath);
        }
      }
      if (rollbackFailures.length) {
        throw new Error(`Undo failed and CodeCrew could not restore the applied state for: ${rollbackFailures.join(", ")}.`);
      }
      throw error;
    }
  }

  private cleanup(items: Checkpoint[]): Checkpoint[] {
    const cutoff = Date.now() - MAX_AGE;
    let bytes = 0;
    return items
      .filter((item) => item.timestamp >= cutoff)
      .slice(0, MAX_ITEMS)
      .filter((item) => {
        const size = checkpointSize(item);
        if (bytes + size > MAX_BYTES) return false;
        bytes += size;
        return true;
      });
  }
}

function checkpointSize(item: Checkpoint): number {
  return item.files.reduce(
    (sum, file) => sum + Buffer.byteLength(file.beforeContent) + Buffer.byteLength(file.afterContent),
    0
  );
}
