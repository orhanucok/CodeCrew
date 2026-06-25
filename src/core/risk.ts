import { Risk } from "../types/run";
import { VirtualFileChange } from "../types/patch";

export function assessRisk(changes: VirtualFileChange[]): { risk: Risk; reason: string } {
  const paths = changes.map((change) => change.filePath.toLowerCase());
  if (paths.some((value) => /auth|payment|schema|config/.test(value)) || changes.some((change) => change.afterContent.length - change.beforeContent.length > 5000)) {
    return { risk: "High", reason: "The change touches sensitive or broad project behavior." };
  }
  if (paths.some((value) => /api|route|server|database/.test(value)) || changes.some((change) => !change.isNew && changedLines(change) > 30)) {
    return { risk: "Medium", reason: "Existing application logic is being changed." };
  }
  return { risk: "Low", reason: "The change is small and limited to selected code or a new file." };
}

function changedLines(change: VirtualFileChange): number {
  return Math.abs(change.afterContent.split(/\r?\n/).length - change.beforeContent.split(/\r?\n/).length) + 1;
}
