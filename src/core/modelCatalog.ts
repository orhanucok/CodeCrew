import { ModelCandidate } from "../types/model";

export const FREE_ROUTER_MODEL = "openrouter/free";

export const fallbackCandidates: ModelCandidate[] = [
  {
    id: "cohere/north-mini-code:free",
    displayName: "Cohere North Mini Code (free)",
    provider: "openrouter",
    isFree: true,
    isPaid: false,
    tags: ["code", "reasoning", "free"],
    knownCodingCapability: "high",
    knownReasoningCapability: "medium",
    contextWindow: 256000,
    defaultEnabled: true,
    recommendedForPatchGeneration: true,
    recommendedForExplain: true,
    recommendedForTests: true
  },
  {
    id: "qwen/qwen3-coder:free",
    displayName: "Qwen 3 Coder (free)",
    provider: "openrouter",
    isFree: true,
    isPaid: false,
    tags: ["code", "reasoning", "free"],
    knownCodingCapability: "high",
    knownReasoningCapability: "high",
    defaultEnabled: true,
    recommendedForPatchGeneration: true,
    recommendedForExplain: true,
    recommendedForTests: true
  },
  {
    id: FREE_ROUTER_MODEL,
    displayName: "OpenRouter Free Models Router",
    provider: "openrouter",
    isFree: true,
    isPaid: false,
    tags: ["free", "router", "last-resort"],
    knownCodingCapability: "unknown",
    knownReasoningCapability: "unknown",
    defaultEnabled: true,
    recommendedForPatchGeneration: false,
    recommendedForExplain: true,
    recommendedForTests: false
  },
  {
    id: "moonshotai/kimi-k2.7-code",
    displayName: "MoonshotAI Kimi K2.7 Code",
    provider: "openrouter",
    isFree: false,
    isPaid: true,
    tags: ["code", "reasoning", "paid"],
    knownCodingCapability: "high",
    knownReasoningCapability: "high",
    contextWindow: 262144,
    defaultEnabled: false,
    recommendedForPatchGeneration: true,
    recommendedForExplain: true,
    recommendedForTests: true
  }
];

export interface OpenRouterModelRecord {
  id?: string;
  name?: string;
  description?: string;
  context_length?: number;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { output_modalities?: string[]; modality?: string };
  reasoning?: unknown;
}

export function mergeModelCatalog(remote: OpenRouterModelRecord[]): ModelCandidate[] {
  const merged = new Map(fallbackCandidates.map((candidate) => [candidate.id, candidate]));
  for (const model of remote) {
    const candidate = candidateFromRemote(model);
    if (!candidate) continue;
    const local = merged.get(candidate.id);
    merged.set(candidate.id, local ? { ...candidate, ...local, contextWindow: candidate.contextWindow ?? local.contextWindow } : candidate);
  }
  return [...merged.values()];
}

export function candidateFromRemote(model: OpenRouterModelRecord): ModelCandidate | undefined {
  if (!model.id || model.id.startsWith("~")) return undefined;
  const output = model.architecture?.output_modalities ?? [];
  if (output.length > 0 && !output.includes("text")) return undefined;
  const text = `${model.id} ${model.name ?? ""} ${model.description ?? ""}`.toLowerCase();
  const excluded = /content[- ]?safety|moderation|embedding|embed|rerank|image|video|audio|music|tts|asr|transcription|whisper|speech|vision[- ]?only|\bvl\b/.test(text);
  if (excluded) return undefined;
  const coding = /code|coder|program|software|developer/.test(text);
  const reasoning = Boolean(model.reasoning) || /reason|think|logic|instruct|chat|qwen|deepseek|kimi|gpt-oss|llama|hermes|nemotron|poolside/.test(text);
  if (!coding && !reasoning) return undefined;
  const isFree = model.id.endsWith(":free") ||
    (Number(model.pricing?.prompt ?? 1) === 0 && Number(model.pricing?.completion ?? 1) === 0);
  return {
    id: model.id,
    displayName: model.name ?? model.id,
    provider: "openrouter",
    isFree,
    isPaid: !isFree,
    tags: [coding ? "code" : "", reasoning ? "reasoning" : "", isFree ? "free" : "paid"].filter(Boolean),
    knownCodingCapability: coding ? "medium" : "unknown",
    knownReasoningCapability: reasoning ? "medium" : "unknown",
    contextWindow: model.context_length,
    defaultEnabled: isFree,
    recommendedForPatchGeneration: coding,
    recommendedForExplain: coding || reasoning,
    recommendedForTests: coding
  };
}
