import * as vscode from "vscode";
import { VirtualFileChange } from "../types/patch";

export class VirtualDocumentProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();
  private readonly emitter = new vscode.EventEmitter<vscode.Uri>();
  readonly onDidChange = this.emitter.event;

  set(uri: vscode.Uri, content: string): void {
    this.contents.set(uri.toString(), content);
    this.emitter.fire(uri);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    return this.contents.get(uri.toString()) ?? "";
  }
}

export class DiffManager {
  constructor(private readonly provider: VirtualDocumentProvider) {}

  async show(root: string, change: VirtualFileChange): Promise<void> {
    const left = vscode.Uri.parse(`codecrew-before:${change.filePath}`);
    const right = vscode.Uri.parse(`codecrew-after:${change.filePath}`);
    this.provider.set(left, change.beforeContent);
    this.provider.set(right, change.afterContent);
    await vscode.commands.executeCommand("vscode.diff", left, right, `CodeCrew Preview: ${change.filePath}`, { preview: false });
  }

  async showAll(root: string, changes: VirtualFileChange[]): Promise<void> {
    for (const change of changes) await this.show(root, change);
  }
}
