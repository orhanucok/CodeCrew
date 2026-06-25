import { promises as fs } from "node:fs";
import * as path from "node:path";

export class UnsafeWorkspacePathError extends Error {
  constructor(target: string) {
    super(`Patch target must stay inside the current workspace: ${target}`);
  }
}

export function normalizeWorkspaceRelative(root: string, target: string): string {
  const absolute = path.resolve(root, target);
  const relative = path.relative(path.resolve(root), absolute);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new UnsafeWorkspacePathError(target);
  }
  return relative.replace(/\\/g, "/");
}

export async function resolveWorkspaceFile(root: string, relativePath: string): Promise<string> {
  const normalized = normalizeWorkspaceRelative(root, relativePath);
  const rootReal = await fs.realpath(root);
  const absolute = path.resolve(root, normalized);
  let cursor = absolute;
  while (true) {
    try {
      const info = await fs.lstat(cursor);
      if (info.isSymbolicLink()) throw new UnsafeWorkspacePathError(relativePath);
      const real = await fs.realpath(cursor);
      if (!isWithin(rootReal, real)) throw new UnsafeWorkspacePathError(relativePath);
      break;
    } catch (error) {
      if (error instanceof UnsafeWorkspacePathError) throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw new UnsafeWorkspacePathError(relativePath);
      cursor = parent;
    }
  }
  await rejectSymlinkComponents(root, normalized);
  return absolute;
}

async function rejectSymlinkComponents(root: string, relativePath: string): Promise<void> {
  let cursor = path.resolve(root);
  for (const part of relativePath.split("/")) {
    cursor = path.join(cursor, part);
    try {
      if ((await fs.lstat(cursor)).isSymbolicLink()) throw new UnsafeWorkspacePathError(relativePath);
    } catch (error) {
      if (error instanceof UnsafeWorkspacePathError) throw error;
      return;
    }
  }
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
