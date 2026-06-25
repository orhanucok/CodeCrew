export const DIRTY_FILE_MESSAGE =
  "This file has unsaved changes. Save the file before CodeCrew generates a patch to avoid conflicts.";
export const SAVE_AND_CONTINUE = "Save and continue";
export const CANCEL = "Cancel";

interface DirtyDocument {
  readonly isDirty: boolean;
  save(): Thenable<boolean>;
}

export async function ensureSavedBeforeGeneration(
  document: DirtyDocument,
  prompt: (message: string, ...buttons: string[]) => Thenable<string | undefined>
): Promise<void> {
  if (!document.isDirty) return;
  const choice = await prompt(DIRTY_FILE_MESSAGE, SAVE_AND_CONTINUE, CANCEL);
  if (choice !== SAVE_AND_CONTINUE || !(await document.save())) throw new Error("Cancelled.");
}
