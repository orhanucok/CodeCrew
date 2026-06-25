export interface ModelCall {
  apiKey: string;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature: number;
  timeoutMs: number;
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number
  ) { super(message); }
}

export async function callModel(input: ModelCall): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://codecrew.local",
        "X-Title": "CodeCrew"
      },
      body: JSON.stringify({ model: input.model, messages: input.messages, temperature: input.temperature }),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new OpenRouterError(
        messageForStatus(response.status),
        response.status,
        parseRetryAfter(response.headers.get("retry-after"))
      );
    }
    const body = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = body.choices?.[0]?.message?.content;
    if (!content) throw new OpenRouterError("The model returned an invalid response.");
    return content;
  } catch (error) {
    if (error instanceof OpenRouterError) throw error;
    if ((error as Error).name === "AbortError") throw new OpenRouterError("The coding model timed out.", 408);
    throw new OpenRouterError("OpenRouter could not be reached.");
  } finally {
    clearTimeout(timer);
  }
}

export function messageForStatus(status: number): string {
  if (status === 401) return "Your OpenRouter API key is invalid. Please update it in CodeCrew settings.";
  if (status === 402) return "OpenRouter account or credit issue. Free models may be unavailable until the account is fixed.";
  if (status === 408) return "The coding model timed out.";
  if (status === 429 || status === 503) return "Free coding model is busy. Trying fallback.";
  if (status === 500 || status === 502) return "The model provider is temporarily unavailable.";
  return "OpenRouter could not complete the request.";
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, date - now);
}
