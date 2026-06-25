import * as vscode from "vscode";
import * as path from "node:path";
import { TaskContext } from "../types/context";
import { fingerprintFile } from "./fingerprint";
import { scanProject, formatProjectSummary } from "./projectScanner";
import { detectStyle } from "./styleDetector";
import { ensureSavedBeforeGeneration } from "./dirtyFileGuard";

export async function collectContext(
  command: TaskContext["command"],
  instruction: string
): Promise<{ context: TaskContext; root: string }> {
  const editor = vscode.window.activeTextEditor;
  if (!editor || editor.document.uri.scheme !== "file") throw new Error("Open a saved JavaScript or TypeScript file first.");
  if (!["javascript", "javascriptreact", "typescript", "typescriptreact"].includes(editor.document.languageId)) {
    throw new Error("CodeCrew V1 supports JavaScript and TypeScript files.");
  }
  await ensureSavedBeforeGeneration(
    editor.document,
    (message, ...buttons) => vscode.window.showWarningMessage(message, ...buttons)
  );
  const folder = vscode.workspace.getWorkspaceFolder(editor.document.uri);
  if (!folder) throw new Error("Open the file inside a VS Code workspace.");
  const selection = editor.selection;
  const content = editor.document.getText();
  const filePath = path.relative(folder.uri.fsPath, editor.document.uri.fsPath).replace(/\\/g, "/");
  const diagnostics = vscode.languages
    .getDiagnostics(editor.document.uri)
    .filter((item) => selection.isEmpty || item.range.intersection(selection))
    .map((item) => item.message);
  const project = await scanProject(folder.uri.fsPath);
  const fingerprint = await fingerprintFile(editor.document.uri.fsPath, content, false, {
    startLine: selection.start.line,
    startCharacter: selection.start.character,
    endLine: selection.end.line,
    endCharacter: selection.end.character
  });
  return {
    root: folder.uri.fsPath,
    context: {
      command,
      instruction,
      filePath,
      fileContent: content,
      selectedCode: editor.document.getText(selection),
      selectedRange: fingerprint.selection,
      problems: diagnostics,
      projectSummary: formatProjectSummary(project),
      styleNote: await detectStyle(folder.uri.fsPath, content),
      fingerprint
    }
  };
}
