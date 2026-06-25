import { promises as fs } from "node:fs";
import * as path from "node:path";
import { ProjectSummary } from "../types/project";

export async function scanProject(root: string): Promise<ProjectSummary> {
  let pkg: { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } = {};
  try { pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")); } catch {}
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const exists = async (name: string) => fs.access(path.join(root, name)).then(() => true, () => false);
  const framework = deps.next || await exists("next.config.js") || await exists("next.config.ts")
    ? "Next.js"
    : deps.vite || await exists("vite.config.js") || await exists("vite.config.ts")
      ? "Vite"
      : deps.react
        ? "React"
        : deps.express
          ? "Express"
          : "Node.js";
  const packageManager = await exists("pnpm-lock.yaml") ? "pnpm" : await exists("yarn.lock") ? "yarn" : "npm";
  return {
    framework,
    language: await exists("tsconfig.json") ? "TypeScript" : "JavaScript",
    packageManager,
    scripts: ["build", "lint", "test"].filter((name) => pkg.scripts?.[name]),
    safeMode: true
  };
}

export function formatProjectSummary(summary: ProjectSummary): string {
  return `Framework: ${summary.framework}; Language: ${summary.language}; Package manager: ${summary.packageManager}; Scripts: ${summary.scripts.join(", ") || "none"}; Safe Mode ON`;
}
