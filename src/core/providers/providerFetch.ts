import { ProviderError, providerErrorFromResponse } from "./providerError";

export async function fetchJson(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) throw providerErrorFromResponse(response);
    return await response.json();
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new ProviderError("AI provider timed out.", 408);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function extractOpenAIText(body: unknown): string {
  const content = (body as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new ProviderError("AI provider returned an invalid response.", 502);
  return content;
}
