import * as vscode from "vscode";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { promises as fs } from "node:fs";
import * as path from "node:path";

export class CheckpointStorage {
  private readonly filePath: string;
  private values: Record<string, unknown> = {};

  constructor(context: vscode.ExtensionContext) {
    const directory = context.globalStorageUri.fsPath;
    mkdirSync(directory, { recursive: true });
    this.filePath = path.join(directory, "checkpoints.json");
    if (existsSync(this.filePath)) {
      try {
        this.values = JSON.parse(readFileSync(this.filePath, "utf8")) as Record<string, unknown>;
      } catch {
        this.values = {};
      }
    }
  }

  get<T>(key: string, fallback: T): T {
    return (this.values[key] as T | undefined) ?? fallback;
  }

  async update<T>(key: string, value: T): Promise<void> {
    this.values[key] = value;
    const temporary = `${this.filePath}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(this.values), "utf8");
    await fs.rename(temporary, this.filePath).catch(async () => {
      await fs.rm(this.filePath, { force: true });
      await fs.rename(temporary, this.filePath);
    });
  }
}
