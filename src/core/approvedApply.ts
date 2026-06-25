import { Checkpoint } from "../types/checkpoint";
import { VirtualFileChange } from "../types/patch";
import { Risk, RunRecord } from "../types/run";
import { applyChangesTransactionally } from "./applyManager";

interface CheckpointService {
  create(summary: string, changes: VirtualFileChange[]): Promise<Checkpoint>;
  remove(id: string): Promise<void>;
}

interface HistoryService {
  add(run: RunRecord): Promise<void>;
}

export async function applyApprovedRun(
  root: string,
  summary: string,
  risk: Risk,
  changes: VirtualFileChange[],
  checkpoints: CheckpointService,
  history: HistoryService,
  apply: typeof applyChangesTransactionally = applyChangesTransactionally
): Promise<Checkpoint> {
  const checkpoint = await checkpoints.create(summary, changes);
  try {
    await apply(root, changes);
  } catch (error) {
    try {
      await checkpoints.remove(checkpoint.id);
    } catch {
      throw new Error("Apply failed and CodeCrew could not remove the unused checkpoint.");
    }
    throw error;
  }
  await history.add({
    id: `${Date.now()}`,
    timestamp: Date.now(),
    summary,
    changedFiles: changes.map((change) => change.filePath),
    risk,
    cost: 0,
    checkpointId: checkpoint.id
  });
  return checkpoint;
}
