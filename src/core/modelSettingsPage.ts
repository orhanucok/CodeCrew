import * as vscode from "vscode";
import { Storage } from "./storage";
import { fallbackCandidates, FREE_ROUTER_MODEL, mergeModelCatalog } from "./modelCatalog";
import { fetchOpenRouterModels, rankCandidatesForHealthCheck, scoreModel } from "./modelRouter";
import {
  defaultModelSettings,
  loadModelSettings,
  loadModelStats,
  resetModelSettings,
  saveModelSettings
} from "./modelSettings";
import { getCachedHealth, refreshModelHealth } from "./healthCheck";
import { ModelCandidate, ModelHealth, ModelSettings } from "../types/model";
import { sanitizeSelectionsForHealth } from "./modelSettingsValidation";

export class ModelSettingsPage {
  private panel?: vscode.WebviewPanel;
  private candidates: ModelCandidate[] = fallbackCandidates;
  private health: Record<string, ModelHealth> = {};

  constructor(private readonly storage: Storage) {}

  async show(): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
      await this.render();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      "codecrew.models",
      "CodeCrew — Advanced Settings — Models",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.panel.onDidDispose(() => { this.panel = undefined; });
    this.panel.webview.onDidReceiveMessage((message: ModelSettingsMessage) => void this.handleMessage(message));
    this.panel.webview.html = getHtml(this.panel.webview);
    await this.loadCatalog();
    await this.render();
  }

  private async handleMessage(message: ModelSettingsMessage): Promise<void> {
    if (message.type === "refresh") {
      const apiKey = await this.storage.getApiKey();
      if (!apiKey) {
        void vscode.window.showWarningMessage("Set your OpenRouter API key before refreshing model status.");
        return;
      }
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "CodeCrew: Refreshing model status" },
        async () => {
          await this.loadCatalog();
          const settings = loadModelSettings(this.storage);
          const stats = loadModelStats(this.storage);
          const freeIds = rankCandidatesForHealthCheck(
            this.candidates.filter((candidate) => candidate.isFree),
            settings,
            stats,
            "patch"
          )
            .filter((candidate) => candidate.id !== FREE_ROUTER_MODEL)
            .slice(0, 8)
            .map((candidate) => candidate.id);
          this.health = await refreshModelHealth(apiKey, freeIds);
          this.health[FREE_ROUTER_MODEL] = { modelId: FREE_ROUTER_MODEL, state: "Ready", checkedAt: Date.now() };
          await saveModelSettings(this.storage, {
            ...settings,
            selectedFreeModelIds: settings.selectedFreeModelIds.filter(
              (id) => this.health[id]?.state === "Ready"
            )
          });
        }
      );
      await this.render();
      return;
    }
    if (message.type === "reset") {
      await resetModelSettings(this.storage);
      await this.render();
      return;
    }
    if (message.type === "save") {
      const current = loadModelSettings(this.storage);
      const requested = { ...current, ...message.settings };
      await saveModelSettings(
        this.storage,
        sanitizeSelectionsForHealth(requested, this.candidates, this.health)
      );
      await this.render();
    }
  }

  private async loadCatalog(): Promise<void> {
    const apiKey = await this.storage.getApiKey();
    if (!apiKey) {
      this.candidates = fallbackCandidates;
      return;
    }
    const remote = await fetchOpenRouterModels(apiKey).catch(() => []);
    this.candidates = mergeModelCatalog(remote);
    for (const candidate of this.candidates) {
      const cached = getCachedHealth(apiKey, candidate.id);
      if (cached) this.health[candidate.id] = cached;
    }
  }

  private healthFor(candidate: ModelCandidate): ModelHealth {
    if (candidate.id === FREE_ROUTER_MODEL) {
      return this.health[candidate.id] ?? { modelId: candidate.id, state: "Ready" };
    }
    return this.health[candidate.id] ?? { modelId: candidate.id, state: "Untested" };
  }

  private async render(): Promise<void> {
    if (!this.panel) return;
    const settings = loadModelSettings(this.storage);
    const stats = loadModelStats(this.storage);
    const models = this.candidates
      .map((candidate) => scoreModel(candidate, this.healthFor(candidate), stats[candidate.id], "patch"))
      .sort((a, b) => {
        if (a.candidate.isFree !== b.candidate.isFree) return a.candidate.isFree ? -1 : 1;
        if (a.candidate.id === FREE_ROUTER_MODEL) return 1;
        if (b.candidate.id === FREE_ROUTER_MODEL) return -1;
        return b.score - a.score;
      })
      .map(({ candidate, health, badge }) => ({ candidate, health, badge }))
      .filter((item, index, all) => {
        const group = all.filter((candidate) => candidate.candidate.isFree === item.candidate.isFree);
        return group.indexOf(item) < 20;
      });
    await this.panel.webview.postMessage({ type: "render", settings, models });
  }
}

type ModelSettingsMessage =
  | { type: "refresh" }
  | { type: "reset" }
  | { type: "save"; settings: ModelSettings };

function getHtml(webview: vscode.Webview): string {
  const nonce = Math.random().toString(36).slice(2);
  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style>
    body { padding: 18px; max-width: 860px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
    h1 { font-size: 20px; } h2 { font-size: 15px; margin-top: 24px; }
    .note { color: var(--vscode-descriptionForeground); }
    .toolbar, .toggles { display: flex; gap: 12px; flex-wrap: wrap; margin: 12px 0; }
    .model { display: grid; grid-template-columns: 24px 1fr auto; gap: 8px; padding: 8px 0; border-bottom: 1px solid var(--vscode-panel-border); }
    .meta { color: var(--vscode-descriptionForeground); font-size: 12px; }
    .badge { border: 1px solid var(--vscode-panel-border); border-radius: 10px; padding: 2px 7px; font-size: 11px; }
    button { padding: 5px 10px; } label { user-select: none; }
  </style>
</head>
<body>
  <h1>Advanced Settings → Models</h1>
  <p class="note">Auto mode is recommended. Model controls never interrupt the normal Fix this workflow.</p>
  <div class="toggles">
    <label><input id="autoMode" type="checkbox"> Auto: choose best available free model</label>
    <label><input id="manual" type="checkbox"> Manual preferred model list</label>
    <label><input id="freeFallback" type="checkbox"> Allow automatic free fallback</label>
    <label><input id="paidFallback" type="checkbox"> Enable paid fallback</label>
  </div>
  <div class="toolbar">
    <button id="refresh">Refresh model status</button>
    <button id="reset">Reset to recommended defaults</button>
  </div>
  <h2>Free models</h2><div id="free"></div>
  <h2>Paid models</h2><div id="paid"></div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    let current = ${JSON.stringify(defaultModelSettings)};
    let models = [];
    const send = () => vscode.postMessage({ type: 'save', settings: {
      autoMode: document.getElementById('autoMode').checked,
      manualPreferredModelsEnabled: document.getElementById('manual').checked,
      allowAutomaticFreeFallback: document.getElementById('freeFallback').checked,
      paidFallbackEnabled: document.getElementById('paidFallback').checked,
      selectedFreeModelIds: [...document.querySelectorAll('input[data-free]:checked')].map(x => x.value),
      selectedPaidModelIds: [...document.querySelectorAll('input[data-paid]:checked')].map(x => x.value)
    }});
    document.getElementById('refresh').onclick = () => vscode.postMessage({ type: 'refresh' });
    document.getElementById('reset').onclick = () => vscode.postMessage({ type: 'reset' });
    document.getElementById('autoMode').onchange = event => {
      document.getElementById('manual').checked = !event.target.checked;
      send();
    };
    document.getElementById('manual').onchange = event => {
      document.getElementById('autoMode').checked = !event.target.checked;
      send();
    };
    document.getElementById('freeFallback').onchange = send;
    document.getElementById('paidFallback').onchange = send;
    window.addEventListener('message', event => {
      if (event.data.type !== 'render') return;
      current = event.data.settings; models = event.data.models;
      document.getElementById('autoMode').checked = current.autoMode;
      document.getElementById('manual').checked = current.manualPreferredModelsEnabled;
      document.getElementById('freeFallback').checked = current.allowAutomaticFreeFallback;
      document.getElementById('paidFallback').checked = current.paidFallbackEnabled;
      renderGroup('free', models.filter(x => x.candidate.isFree), true);
      renderGroup('paid', models.filter(x => x.candidate.isPaid), false);
    });
    function renderGroup(target, items, free) {
      const root = document.getElementById(target); root.textContent = '';
      for (const item of items) {
        const row = document.createElement('div'); row.className = 'model';
        const input = document.createElement('input'); input.type = 'checkbox'; input.value = item.candidate.id;
        input.dataset[free ? 'free' : 'paid'] = '1';
        input.checked = (free ? current.selectedFreeModelIds : current.selectedPaidModelIds).includes(item.candidate.id);
        input.disabled = free ? item.health.state !== 'Ready' : !current.paidFallbackEnabled;
        input.onchange = send;
        const text = document.createElement('div');
        const title = document.createElement('div');
        const dot = statusIcon(item.health.state, free);
        title.textContent = dot + ' ' + item.candidate.displayName + (free ? '' : ' — Paid');
        const meta = document.createElement('div'); meta.className = 'meta';
        meta.textContent = free
          ? item.health.state + ' · ' + item.candidate.id
          : (current.paidFallbackEnabled ? 'Paid' : 'Paid locked') + ' · ' + item.candidate.id;
        text.append(title, meta);
        const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = item.badge;
        row.append(input, text, badge); root.append(row);
      }
      if (!items.length) root.textContent = 'No models available.';
    }
    function statusIcon(state, free) {
      if (!free) return '🔒';
      if (state === 'Ready') return '🟢';
      if (['Busy','Slow','RateLimited','Cooldown'].includes(state)) return '🟡';
      if (['Failed','Unavailable'].includes(state)) return '🔴';
      return '⚪';
    }
  </script>
</body>
</html>`;
}
