import * as vscode from "vscode";
import { ProviderSecretSlot, Storage } from "../storage";
import { cachedProviderHealth, clearProviderHealthCache } from "./providerHealthCache";
import { ProviderRegistry } from "./providerRegistry";
import { loadProviderSettings, saveProviderSettings } from "./providerSettings";
import { ProviderHealthResult, ProviderId } from "./types";
import { clearPatchProbeCache } from "./freeFirstRouter";

interface ProviderView {
  id: ProviderId;
  displayName: string;
  configured: boolean;
  enabled: boolean;
  status: string;
  checkedAt?: number;
}

export class ProviderSettingsPage {
  private panel?: vscode.WebviewPanel;
  private readonly statuses = new Map<ProviderId, ProviderHealthResult>();

  constructor(
    private readonly storage: Storage,
    private readonly registry: ProviderRegistry
  ) {}

  async show(): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
      await this.render();
      return;
    }
    this.panel = vscode.window.createWebviewPanel(
      "codecrew.providers",
      "CodeCrew — Advanced Settings — Providers",
      vscode.ViewColumn.Active,
      { enableScripts: true, retainContextWhenHidden: true }
    );
    this.panel.onDidDispose(() => { this.panel = undefined; });
    this.panel.webview.onDidReceiveMessage((message: ProviderMessage) => void this.handleMessage(message));
    this.panel.webview.html = providerHtml();
    await this.render();
  }

  private async handleMessage(message: ProviderMessage): Promise<void> {
    const provider = this.registry.get(message.providerId);
    if (!provider) return;
    if (message.type === "key") {
      await this.promptForProviderSecrets(message.providerId, provider.displayName);
    } else if (message.type === "test") {
      if (!(await provider.isConfigured())) {
        void vscode.window.showWarningMessage(`${provider.displayName} is not configured.`);
        return;
      }
      const models = await provider.listModels().catch(() => []);
      const model = models.find((candidate) => candidate.isFreeTier) ?? models[0];
      if (!model) {
        this.statuses.set(provider.id, { status: "Unavailable", checkedAt: Date.now() });
      } else {
        const result = await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: `Testing ${provider.displayName}` },
          () => cachedProviderHealth(provider, model, true)
        );
        this.statuses.set(provider.id, result);
      }
    } else if (message.type === "toggle") {
      const settings = loadProviderSettings(this.storage);
      const next = new Set(settings.enabledProviderIds);
      message.enabled ? next.add(message.providerId) : next.delete(message.providerId);
      await saveProviderSettings(this.storage, { enabledProviderIds: [...next] });
    }
    await this.render();
  }

  private async promptForProviderSecrets(providerId: ProviderId, displayName: string): Promise<void> {
    if (providerId === "cloudflare-workers-ai") {
      const accountId = await vscode.window.showInputBox({
        prompt: `${displayName}: Account ID`,
        password: true,
        ignoreFocusOut: true
      });
      if (!accountId) return;
      const token = await vscode.window.showInputBox({
        prompt: `${displayName}: API token`,
        password: true,
        ignoreFocusOut: true
      });
      if (!token) return;
      await this.storage.setProviderSecret("cloudflare-workers-ai.accountId", accountId.trim());
      await this.storage.setProviderSecret("cloudflare-workers-ai.apiToken", token.trim());
      clearProviderHealthCache();
      clearPatchProbeCache();
      return;
    }
    const slot = secretSlot(providerId);
    const key = await vscode.window.showInputBox({
      prompt: `${displayName}: API key or token`,
      password: true,
      ignoreFocusOut: true
    });
    if (key?.trim()) {
      await this.storage.setProviderSecret(slot, key.trim());
      clearProviderHealthCache();
      clearPatchProbeCache();
    }
  }

  private async render(): Promise<void> {
    if (!this.panel) return;
    const settings = loadProviderSettings(this.storage);
    const providers: ProviderView[] = await Promise.all(this.registry.all().map(async (provider) => {
      const configured = await provider.isConfigured();
      const health = this.statuses.get(provider.id);
      return {
        id: provider.id,
        displayName: provider.displayName,
        configured,
        enabled: settings.enabledProviderIds.includes(provider.id),
        status: configured ? health?.status ?? "Untested" : "Not configured",
        checkedAt: health?.checkedAt
      };
    }));
    await this.panel.webview.postMessage({ type: "render", providers });
  }
}

type ProviderMessage =
  | { type: "key"; providerId: ProviderId }
  | { type: "test"; providerId: ProviderId }
  | { type: "toggle"; providerId: ProviderId; enabled: boolean };

function secretSlot(providerId: Exclude<ProviderId, "cloudflare-workers-ai">): ProviderSecretSlot {
  return providerId;
}

function providerHtml(): string {
  const nonce = Math.random().toString(36).slice(2);
  return `<!doctype html>
<html><head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<style>
body { padding: 18px; max-width: 820px; color: var(--vscode-foreground); font-family: var(--vscode-font-family); }
h1 { font-size: 20px; } .note,.meta { color: var(--vscode-descriptionForeground); }
.provider { display:grid; grid-template-columns: 1fr auto; gap:10px; padding:10px 0; border-bottom:1px solid var(--vscode-panel-border); }
.actions { display:flex; gap:8px; align-items:center; } button { padding:4px 9px; }
</style></head><body>
<h1>Advanced Settings → Providers</h1>
<p class="note">Only configured and enabled providers are checked. API keys stay in VS Code SecretStorage.</p>
<div id="configured"><h2>Configured providers</h2></div>
<div id="available"><h2>Available providers</h2></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
window.addEventListener('message', event => {
  if (event.data.type !== 'render') return;
  const configured = document.getElementById('configured');
  const available = document.getElementById('available');
  configured.querySelectorAll('.provider').forEach(x => x.remove());
  available.querySelectorAll('.provider').forEach(x => x.remove());
  for (const provider of event.data.providers) {
    const row = document.createElement('div'); row.className = 'provider';
    const info = document.createElement('div');
    const title = document.createElement('div');
    title.textContent = icon(provider.status) + ' ' + provider.displayName + ' — ' + provider.status;
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = provider.checkedAt ? 'Last checked: ' + new Date(provider.checkedAt).toLocaleString() : 'Not checked yet';
    info.append(title, meta);
    const actions = document.createElement('div'); actions.className = 'actions';
    const enabled = document.createElement('input'); enabled.type='checkbox'; enabled.checked=provider.enabled;
    enabled.title='Enable or disable provider';
    enabled.onchange=()=>vscode.postMessage({type:'toggle',providerId:provider.id,enabled:enabled.checked});
    const key = document.createElement('button'); key.textContent=provider.configured?'Update API key':'Add API key';
    key.onclick=()=>vscode.postMessage({type:'key',providerId:provider.id});
    const test = document.createElement('button'); test.textContent='Test connection'; test.disabled=!provider.configured;
    test.onclick=()=>vscode.postMessage({type:'test',providerId:provider.id});
    actions.append(enabled,key,test); row.append(info,actions);
    (provider.configured?configured:available).append(row);
  }
});
function icon(status) {
  if (status==='Ready') return '🟢';
  if (['Slow','RateLimited','Cooldown'].includes(status)) return '🟡';
  if (['Unavailable','InvalidKey','QuotaExceeded'].includes(status)) return '🔴';
  return '⚪';
}
</script></body></html>`;
}
