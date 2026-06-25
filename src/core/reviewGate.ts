export async function showDiffBeforeDecision<T>(
  showDiff: () => PromiseLike<void>,
  requestDecision: () => PromiseLike<T>
): Promise<T> {
  await showDiff();
  return requestDecision();
}

export function isApplyApproved(choice: string | undefined): boolean {
  return choice === "Apply";
}
