import * as path from "node:path";

const exact = new Set([".env", ".env.local", ".env.production", "package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);
export const PROTECTED_FILE_MESSAGE =
  "CodeCrew blocked this change because it touches a protected file. Protected files cannot be modified in V1.";

export class ProtectedFileError extends Error {
  constructor(readonly filePath: string) {
    super(PROTECTED_FILE_MESSAGE);
  }
}

export function isProtectedFile(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/").toLowerCase();
  const parts = normalized.split("/");
  return exact.has(path.posix.basename(normalized)) ||
    parts.some((part) => exact.has(part)) ||
    parts.includes("node_modules") ||
    parts.includes(".git");
}

export function assertFileIsNotProtected(filePath: string): void {
  if (isProtectedFile(filePath)) throw new ProtectedFileError(filePath);
}
