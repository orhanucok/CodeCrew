import { FREE_ROUTER_MODEL } from "./modelCatalog";
import { ModelCandidate, ModelHealth, ModelSettings } from "../types/model";

export function sanitizeSelectionsForHealth(
  settings: ModelSettings,
  candidates: ModelCandidate[],
  health: Record<string, ModelHealth>
): ModelSettings {
  const readyFree = new Set(
    candidates
      .filter((candidate) =>
        candidate.isFree &&
        (candidate.id === FREE_ROUTER_MODEL || health[candidate.id]?.state === "Ready")
      )
      .map((candidate) => candidate.id)
  );
  return {
    ...settings,
    selectedFreeModelIds: settings.selectedFreeModelIds.filter((id) => readyFree.has(id)),
    selectedPaidModelIds: settings.paidFallbackEnabled
      ? settings.selectedPaidModelIds.filter(
        (id) => candidates.some((candidate) => candidate.id === id && candidate.isPaid)
      )
      : []
  };
}
