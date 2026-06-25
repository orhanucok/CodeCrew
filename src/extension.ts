import * as vscode from "vscode";
import { Storage } from "./core/storage";
import { collectContext } from "./core/contextCollector";
import { buildPrompt } from "./core/promptBuilder";
import {
  PAID_CONFIRMATION_MESSAGE
} from "./core/modelRouter";
import { fingerprintMatches } from "./core/fingerprint";
import { VirtualDocumentProvider, DiffManager } from "./core/diffManager";
import { CheckpointManager, UNDO_BLOCKED_MESSAGE } from "./core/checkpointManager";
import { RunHistory } from "./core/runHistory";
import { assessRisk } from "./core/risk";
import { VirtualFileChange } from "./types/patch";
import { TaskContext } from "./types/context";
import { assertChangesAreCurrent, FileConflictError } from "./core/conflictManager";
import { prepareSafeChanges, SMALLER_PATCH_MESSAGE } from "./core/patchWorkflow";
import { CheckpointStorage } from "./core/checkpointStorage";
import { applyApprovedRun } from "./core/approvedApply";
import { PROTECTED_FILE_MESSAGE, ProtectedFileError } from "./core/protectedFiles";
import { FILE_CHANGED_MESSAGE, REFRESH_AND_RETRY, shouldStartNewRun } from "./core/conflictRecovery";
import { isApplyApproved, showDiffBeforeDecision } from "./core/reviewGate";
import { ModelSettingsPage } from "./core/modelSettingsPage";
import { parsePatch, PatchParseError } from "./core/patchParser";
import { buildVirtualChanges } from "./core/localBuilder";
import { ProviderRegistry } from "./core/providers/providerRegistry";
import {
  callWithFreeProviders,
  InvalidProviderResponseError
} from "./core/providers/freeFirstRouter";
import { ProviderSettingsPage } from "./core/providers/providerSettingsPage";
import { loadProviderSettings } from "./core/providers/providerSettings";

export function activate(extensionContext: vscode.ExtensionContext): void {
  const storage = new Storage(extensionContext);
  const checkpoints = new CheckpointManager(new CheckpointStorage(extensionContext));
  const history = new RunHistory(storage);
  const provider = new VirtualDocumentProvider();
  const diffs = new DiffManager(provider);
  const sidebar = new SidebarProvider();
  const modelSettingsPage = new ModelSettingsPage(storage);
  const providerRegistry = new ProviderRegistry(storage);
  const providerSettingsPage = new ProviderSettingsPage(storage, providerRegistry);
  extensionContext.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider("codecrew-before", provider),
    vscode.workspace.registerTextDocumentContentProvider("codecrew-after", provider),
    vscode.window.registerWebviewViewProvider("codecrew.sidebar", sidebar),
    register("codecrew.fix", (...args) => runTask("fix", storage, providerRegistry, checkpoints, history, diffs, sidebar, args)),
    register("codecrew.explain", (...args) => runTask("explain", storage, providerRegistry, checkpoints, history, diffs, sidebar, args)),
    register("codecrew.improve", (...args) => runTask("improve", storage, providerRegistry, checkpoints, history, diffs, sidebar, args)),
    register("codecrew.addTypes", (...args) => runTask("addTypes", storage, providerRegistry, checkpoints, history, diffs, sidebar, args)),
    register("codecrew.writeTests", (...args) => runTask("writeTests", storage, providerRegistry, checkpoints, history, diffs, sidebar, args)),
    register("codecrew.setApiKey", () => setApiKey(storage)),
    register("codecrew.undo", () => undo(checkpoints, sidebar)),
    register("codecrew.showHistory", () => showHistory(history)),
    register("codecrew.modelSettings", () => modelSettingsPage.show()),
    register("codecrew.providerSettings", () => providerSettingsPage.show())
  );
  void refreshUndoAvailability(checkpoints, sidebar);
  extensionContext.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => void refreshUndoAvailability(checkpoints, sidebar)),
    vscode.workspace.onDidChangeTextDocument(() => void refreshUndoAvailability(checkpoints, sidebar))
  );
}

function register(command: string, action: (...args: unknown[]) => unknown): vscode.Disposable {
  return vscode.commands.registerCommand(command, async (...args: unknown[]) => {
    try { await action(...args); } catch (error) {
      if ((error as Error).message !== "Cancelled.") void vscode.window.showErrorMessage((error as Error).message);
    }
  });
}

async function runTask(
  command: TaskContext["command"],
  storage: Storage,
  providerRegistry: ProviderRegistry,
  checkpoints: CheckpointManager,
  history: RunHistory,
  diffs: DiffManager,
  sidebar: SidebarProvider,
  commandArgs: unknown[] = []
): Promise<void> {
  try {
    await focusCommandTarget(commandArgs);
    const instruction = await instructionFor(command);
    if (!instruction) return;
    if (isLargeTask(instruction)) {
      const choice = await vscode.window.showWarningMessage(
        "This is a large task. CodeCrew V1 works safest step by step. Start with the first small step?",
        "Start small",
        "Cancel"
      );
      if (choice !== "Start small") return;
    }
    const providerSettings = loadProviderSettings(storage);
    if ((await providerRegistry.configured(providerSettings.enabledProviderIds)).length === 0) {
      const choice = await vscode.window.showWarningMessage(
        "No free AI provider is configured. Add a provider API key to continue.",
        "Open Provider Settings",
        "Cancel"
      );
      if (choice === "Open Provider Settings") await vscode.commands.executeCommand("codecrew.providerSettings");
      return;
    }
    await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "CodeCrew", cancellable: false },
    async (progress) => {
      progress.report({ message: "Reading selected code..." });
      const collected = await collectContext(command, instruction);
      progress.report({ message: "Collecting context..." });
      const prompt = buildPrompt(collected.context);
      progress.report({ message: command === "explain" ? "Preparing explanation..." : "Generating safe patch..." });
      let paidConfirmedForRequest = false;
      const confirmPaid = async () => {
        if (paidConfirmedForRequest) return true;
        const choice = await vscode.window.showWarningMessage(
          PAID_CONFIRMATION_MESSAGE,
          { modal: true },
          "Continue",
          "Cancel"
        );
        paidConfirmedForRequest = choice === "Continue";
        return paidConfirmedForRequest;
      };
      const requestModel = (
        userPrompt: string,
        validateResponse?: (content: string) => boolean
      ) => callWithFreeProviders({
        storage,
        registry: providerRegistry,
        messages: [
          { role: "system", content: "You are CodeCrew, a conservative code editing assistant." },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.1,
        timeoutMs: command === "writeTests" ? 45_000 : command === "explain" ? 20_000 : 30_000,
        useCase: command === "explain" ? "explain" : command === "writeTests" ? "tests" : "patch",
        confirmPaid,
        validateResponse: validateResponse
          ? (text) => validateResponse(text)
          : undefined,
        onFallback: () => progress.report({ message: "Free AI provider is busy. Trying another provider." })
      });
      const smallerPrompt = `${prompt}\nThe previous patch was unsafe. Return one smaller exact SEARCH block only. Never guess.`;
      const smallerPatch = async () => {
        const retry = await requestModel(
          smallerPrompt,
          (content) => isValidPatchResponse(content, collected.context.filePath)
        );
        return retry.text;
      };
      let usedSmallerPatch = false;
      let response;
      try {
        response = await requestModel(
          prompt,
          command === "explain" ? undefined : (content) => isValidPatchResponse(content, collected.context.filePath)
        );
      } catch (error) {
        if (command === "explain" || !(error instanceof InvalidProviderResponseError)) throw error;
        progress.report({ message: SMALLER_PATCH_MESSAGE });
        response = { text: await smallerPatch(), providerId: "openrouter" as const, model: "" };
        usedSmallerPatch = true;
      }
      if (command === "explain") {
        await showExplanation(response.text);
        return;
      }
      progress.report({ message: "Checking patch..." });
      let changes: VirtualFileChange[];
      if (usedSmallerPatch) {
        changes = await buildVirtualChanges(
          collected.root,
          parsePatch(response.text, collected.context.filePath)
        );
      } else {
        changes = await prepareSafeChanges(
          collected.root,
          response.text,
          collected.context.filePath,
          smallerPatch,
          () => progress.report({ message: SMALLER_PATCH_MESSAGE })
        );
      }
      if (!(await fingerprintMatches(collected.context.fingerprint))) throw conflictError();
      assertNoDirtyChangedDocuments(collected.root, changes);
      await assertChangesAreCurrent(collected.root, changes);
      progress.report({ message: "Diff ready." });
      await reviewAndApply(collected.root, collected.context, changes, checkpoints, history, diffs, sidebar);
    }
  );
  } catch (error) {
    if (error instanceof FileConflictError || (error as Error).message.includes("changed while CodeCrew")) {
      const choice = await vscode.window.showWarningMessage(
        FILE_CHANGED_MESSAGE,
        REFRESH_AND_RETRY,
        "Cancel"
      );
      if (shouldStartNewRun(choice)) await vscode.commands.executeCommand(`codecrew.${command}`);
      return;
    }
    if (error instanceof ProtectedFileError) {
      void vscode.window.showErrorMessage(PROTECTED_FILE_MESSAGE);
      return;
    }
    throw error;
  }
}

function isValidPatchResponse(content: string, defaultFilePath: string): boolean {
  try {
    parsePatch(content, defaultFilePath);
    return true;
  } catch (error) {
    if (error instanceof ProtectedFileError) throw error;
    if (error instanceof PatchParseError) return false;
    throw error;
  }
}

async function focusCommandTarget(args: unknown[]): Promise<void> {
  const uri = findCommandUri(args);
  if (!uri || uri.scheme !== "file") return;
  const document = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(document, { preview: true });
  const range = findCommandRange(args);
  if (range) {
    editor.selection = new vscode.Selection(range.start, range.end);
    editor.revealRange(range);
  }
}

function findCommandUri(values: unknown[]): vscode.Uri | undefined {
  for (const value of values) {
    if (value instanceof vscode.Uri) return value;
    if (value && typeof value === "object") {
      const candidate = value as { resourceUri?: unknown; uri?: unknown };
      const nested = findCommandUri([candidate.resourceUri, candidate.uri]);
      if (nested) return nested;
    }
  }
  return undefined;
}

function findCommandRange(values: unknown[]): vscode.Range | undefined {
  for (const value of values) {
    if (value instanceof vscode.Range) return value;
    if (value && typeof value === "object") {
      const candidate = value as { range?: unknown };
      const nested = findCommandRange([candidate.range]);
      if (nested) return nested;
    }
  }
  return undefined;
}

async function reviewAndApply(
  root: string,
  context: TaskContext,
  changes: VirtualFileChange[],
  checkpoints: CheckpointManager,
  history: RunHistory,
  diffs: DiffManager,
  sidebar: SidebarProvider,
  previewShown = false
): Promise<void> {
  const { risk, reason } = assessRisk(changes);
  const summary = `${labelFor(context.command)} in ${changes.length} file${changes.length === 1 ? "" : "s"}.`;
  const files = changes.map((change) => change.filePath).join(", ");
  const message = `Changes ready\n\nSummary: ${summary}\nRisk: ${risk}\nConfidence: High\nCost: $0\nChanged files: ${files}\nWhy: Because you asked CodeCrew to ${context.command === "addTypes" ? "add types" : context.command} this code.\nRisk reason: ${reason}`;
  assertNoDirtyChangedDocuments(root, changes);
  await assertChangesAreCurrent(root, changes);
  const requestDecision = () => vscode.window.showInformationMessage(
      message,
      "View Diff",
      "Apply",
      "Reject",
      "Try Again with new instruction",
      "Explain Changes"
    );
  const choice = previewShown
    ? await requestDecision()
    : await showDiffBeforeDecision(() => diffs.showAll(root, changes), requestDecision);
  if (choice === "View Diff") {
    await diffs.showAll(root, changes);
    return reviewAndApply(root, context, changes, checkpoints, history, diffs, sidebar, true);
  }
  if (choice === "Try Again with new instruction") {
    await vscode.commands.executeCommand(`codecrew.${context.command}`);
    return;
  }
  if (choice === "Explain Changes") {
    await showExplanation(`## What changed\n\n${summary}\n\n## Why\n\nBecause you asked CodeCrew to ${context.command === "addTypes" ? "add types to" : context.command} this code.\n\n## Risk\n\n${risk}: ${reason}`);
    return reviewAndApply(root, context, changes, checkpoints, history, diffs, sidebar, true);
  }
  if (!isApplyApproved(choice)) return;
  if (!(await fingerprintMatches(context.fingerprint))) throw conflictError();
  assertNoDirtyChangedDocuments(root, changes);
  await assertChangesAreCurrent(root, changes);
  await applyApprovedRun(root, summary, risk, changes, checkpoints, history);
  await refreshUndoAvailability(checkpoints, sidebar);
  const next = await vscode.window.showInformationMessage("Applied successfully.", "Undo Last AI Change", "Run Build", "Run Lint", "Copy Commit Message");
  if (next === "Undo Last AI Change") await undo(checkpoints, sidebar);
  if (next === "Run Build" || next === "Run Lint") {
    const { runPackageScript } = await import("./core/testRunner");
    await runPackageScript(root, next === "Run Build" ? "build" : "lint");
  }
  if (next === "Copy Commit Message") await vscode.env.clipboard.writeText(`CodeCrew: ${summary}`);
}

async function instructionFor(command: TaskContext["command"]): Promise<string | undefined> {
  const defaults: Record<TaskContext["command"], string> = {
    fix: "Fix the selected code or related VS Code Problem.",
    explain: "Explain the selected code.",
    improve: "Improve the selected code.",
    addTypes: "Add safe TypeScript types to the selected code.",
    writeTests: "Write focused tests for the selected code."
  };
  return vscode.window.showInputBox({ prompt: `CodeCrew: ${labelFor(command)}`, value: defaults[command], ignoreFocusOut: true });
}

async function ensureApiKey(storage: Storage): Promise<string | undefined> {
  const existing = await storage.getApiKey();
  if (existing) return existing;
  await vscode.window.showInformationMessage("CodeCrew starts in Free Mode. Paid models are never used without your approval.");
  return setApiKey(storage);
}

async function setApiKey(storage: Storage): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({ prompt: "Enter your OpenRouter API key", password: true, ignoreFocusOut: true });
  if (value?.trim()) {
    await storage.setApiKey(value.trim());
    void vscode.window.showInformationMessage("OpenRouter API key saved securely.");
    await showFirstRunSummary();
    return value.trim();
  }
  return undefined;
}

async function showFirstRunSummary(): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) return;
  const { scanProject } = await import("./core/projectScanner");
  const project = await scanProject(root);
  void vscode.window.showInformationMessage(
    `Project detected: ${project.framework}, ${project.language}, ${project.packageManager}. ` +
    `Available scripts: ${project.scripts.join(", ") || "none"}. Safe Mode ON.`,
    "Explain current file",
    "Fix current TypeScript error",
    "Improve selected component"
  ).then((choice) => {
    if (choice === "Explain current file") return vscode.commands.executeCommand("codecrew.explain");
    if (choice === "Fix current TypeScript error") return vscode.commands.executeCommand("codecrew.fix");
    if (choice === "Improve selected component") return vscode.commands.executeCommand("codecrew.improve");
    return undefined;
  });
}

async function undo(checkpoints: CheckpointManager, sidebar?: SidebarProvider): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!root) throw new Error("Open a workspace first.");
  const checkpoint = checkpoints.latest();
  if (checkpoint) {
    const dirtyPaths = new Set(
      vscode.workspace.textDocuments
        .filter((document) => document.uri.scheme === "file" && document.isDirty)
        .map((document) => document.uri.fsPath.toLowerCase())
    );
    if (checkpoint.files.some((file) => dirtyPaths.has(vscode.Uri.joinPath(vscode.Uri.file(root), file.filePath).fsPath.toLowerCase()))) {
      throw new Error(UNDO_BLOCKED_MESSAGE);
    }
  }
  await checkpoints.undo(root);
  await refreshUndoAvailability(checkpoints, sidebar);
  void vscode.window.showInformationMessage("Last AI change undone.");
}

async function showHistory(history: RunHistory): Promise<void> {
  const items = history.list().map((run) => ({
    label: run.summary,
    description: `${run.risk} risk · ${run.changedFiles.length} file(s) · ${new Date(run.timestamp).toLocaleString()}`
  }));
  await vscode.window.showQuickPick(items.length ? items : [{ label: "No applied CodeCrew changes yet.", description: "" }], { title: "CodeCrew Run History" });
}

async function showExplanation(content: string): Promise<void> {
  const document = await vscode.workspace.openTextDocument({ content, language: "markdown" });
  await vscode.window.showTextDocument(document, { preview: true });
}

function conflictError(): Error {
  return new FileConflictError(vscode.window.activeTextEditor?.document.uri.fsPath ?? "active file");
}

function assertNoDirtyChangedDocuments(root: string, changes: VirtualFileChange[]): void {
  const targets = new Set(
    changes.map((change) => vscode.Uri.joinPath(vscode.Uri.file(root), change.filePath).fsPath.toLowerCase())
  );
  const dirty = vscode.workspace.textDocuments.some(
    (document) => document.uri.scheme === "file" && document.isDirty && targets.has(document.uri.fsPath.toLowerCase())
  );
  if (dirty) throw conflictError();
}

async function refreshUndoAvailability(checkpoints: CheckpointManager, sidebar?: SidebarProvider): Promise<void> {
  const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const checkpoint = checkpoints.latest();
  const dirty = Boolean(root && checkpoint && hasDirtyCheckpointDocuments(root, checkpoint.files.map((file) => file.filePath)));
  const available = Boolean(root && !dirty && await checkpoints.canUndo(root));
  await vscode.commands.executeCommand("setContext", "codecrew.canUndo", available);
  sidebar?.setUndoEnabled(available);
}

function hasDirtyCheckpointDocuments(root: string, filePaths: string[]): boolean {
  const targets = new Set(
    filePaths.map((filePath) => vscode.Uri.joinPath(vscode.Uri.file(root), filePath).fsPath.toLowerCase())
  );
  return vscode.workspace.textDocuments.some(
    (document) => document.uri.scheme === "file" && document.isDirty && targets.has(document.uri.fsPath.toLowerCase())
  );
}

function isLargeTask(instruction: string): boolean {
  return instruction.length > 500 || /\b(entire|whole|all files|full app|complete project|baştan sona|tüm proje)\b/i.test(instruction);
}

function labelFor(command: TaskContext["command"]): string {
  return ({ fix: "Fix this", explain: "Explain this", improve: "Improve selected code", addTypes: "Add types", writeTests: "Write tests" })[command];
}

export function deactivate(): void {}

class SidebarProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private undoEnabled = false;

  setUndoEnabled(enabled: boolean): void {
    this.undoEnabled = enabled;
    void this.view?.webview.postMessage({ type: "undoEnabled", enabled });
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    const nonce = Math.random().toString(36).slice(2);
    view.webview.html = `<!doctype html>
<html><head>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
</head><body>
<h2>CodeCrew</h2>
<p>Safe AI code changes inside VS Code.</p>
<p>Safe model routing is on. Paid models always require confirmation.</p>
<button data-command="codecrew.fix">Fix this</button>
<button data-command="codecrew.explain">Explain this</button>
<button data-command="codecrew.modelSettings">Advanced Settings → Models</button>
<button data-command="codecrew.providerSettings">Advanced Settings → Providers</button>
<button id="undo" data-command="codecrew.undo"
  title="Undo is unavailable because the file changed after CodeCrew applied the patch."
  ${this.undoEnabled ? "" : "disabled"}>Undo Last AI Change</button>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
document.querySelectorAll('button').forEach(button =>
  button.addEventListener('click', () => vscode.postMessage({ command: button.dataset.command })));
window.addEventListener('message', event => {
  if (event.data.type === 'undoEnabled') document.getElementById('undo').disabled = !event.data.enabled;
});
</script>
</body></html>`;
    view.webview.onDidReceiveMessage((message: { command?: string }) => {
      if (message.command?.startsWith("codecrew.")) void vscode.commands.executeCommand(message.command);
    });
  }
}
