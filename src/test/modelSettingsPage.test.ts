import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeSelectionsForHealth } from "../core/modelSettingsValidation";
import { fallbackCandidates, FREE_ROUTER_MODEL } from "../core/modelCatalog";
import { defaultModelSettings } from "../core/modelSettings";

test("unavailable free models cannot remain selected", () => {
  const free = fallbackCandidates.find((candidate) => candidate.isFree && candidate.id !== FREE_ROUTER_MODEL)!;
  const result = sanitizeSelectionsForHealth(
    { ...defaultModelSettings, selectedFreeModelIds: [free.id] },
    [free],
    { [free.id]: { modelId: free.id, state: "Unavailable" } }
  );
  assert.deepEqual(result.selectedFreeModelIds, []);
});

test("paid models stay locked and unselected while paid fallback is off", () => {
  const paid = fallbackCandidates.find((candidate) => candidate.isPaid)!;
  const result = sanitizeSelectionsForHealth(
    { ...defaultModelSettings, selectedPaidModelIds: [paid.id] },
    [paid],
    {}
  );
  assert.equal(result.paidFallbackEnabled, false);
  assert.deepEqual(result.selectedPaidModelIds, []);
});
