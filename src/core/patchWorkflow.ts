import { ParsedPatch, VirtualFileChange } from "../types/patch";
import { buildVirtualChanges } from "./localBuilder";
import { parsePatch } from "./patchParser";
import { ProtectedFileError } from "./protectedFiles";

export const SMALLER_PATCH_MESSAGE =
  "Patch could not be applied safely. CodeCrew is preparing a smaller, safer patch.";

export async function prepareSafeChanges(
  root: string,
  modelOutput: string,
  defaultFilePath: string,
  smallerPatch: () => Promise<string>,
  onRetry?: () => void
): Promise<VirtualFileChange[]> {
  try {
    return await buildVirtualChanges(root, parsePatch(modelOutput, defaultFilePath));
  } catch (error) {
    if (error instanceof ProtectedFileError) throw error;
    onRetry?.();
    const retryOutput = await smallerPatch();
    return buildVirtualChanges(root, parsePatch(retryOutput, defaultFilePath));
  }
}

export function parseOnly(output: string, defaultFilePath: string): ParsedPatch {
  return parsePatch(output, defaultFilePath);
}
