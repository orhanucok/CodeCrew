import * as vscode from "vscode";
import { promises as fs } from "node:fs";
import * as path from "node:path";

export async function runPackageScript(root: string, script: "build" | "lint" | "test"): Promise<void> {
  const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")) as { scripts?: Record<string, string> };
  if (!pkg.scripts?.[script]) throw new Error(`No ${script} script was found in package.json.`);
  const manager = await detectManager(root);
  const terminal = vscode.window.createTerminal({ name: `CodeCrew ${script}`, cwd: root });
  terminal.show();
  terminal.sendText(manager === "npm" ? `npm run ${script}` : `${manager} ${script}`, true);
}

async function detectManager(root: string): Promise<"npm" | "pnpm" | "yarn"> {
  const exists = (name: string) => fs.access(path.join(root, name)).then(() => true, () => false);
  return await exists("pnpm-lock.yaml") ? "pnpm" : await exists("yarn.lock") ? "yarn" : "npm";
}
