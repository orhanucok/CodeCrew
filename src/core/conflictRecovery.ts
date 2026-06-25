export const FILE_CHANGED_MESSAGE =
  "This file changed while CodeCrew was preparing the patch. To avoid overwriting your work, regenerate the patch.";
export const REFRESH_AND_RETRY = "Refresh and retry";
export const CANCEL = "Cancel";

export function shouldStartNewRun(choice: string | undefined): boolean {
  return choice === REFRESH_AND_RETRY;
}
