import test from "node:test";
import assert from "node:assert/strict";
import { isApplyApproved, showDiffBeforeDecision } from "../core/reviewGate";

test("native diff work completes before the Apply decision is requested", async () => {
  const events: string[] = [];
  const choice = await showDiffBeforeDecision(
    async () => { events.push("diff"); },
    async () => { events.push("decision"); return "Apply"; }
  );
  assert.equal(choice, "Apply");
  assert.deepEqual(events, ["diff", "decision"]);
});

test("Reject and dismissal never authorize a write", () => {
  assert.equal(isApplyApproved("Apply"), true);
  assert.equal(isApplyApproved("Reject"), false);
  assert.equal(isApplyApproved(undefined), false);
});
