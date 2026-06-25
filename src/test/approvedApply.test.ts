import test from "node:test";
import assert from "node:assert/strict";
import { applyApprovedRun } from "../core/approvedApply";
import { Checkpoint } from "../types/checkpoint";

const changes = [{
  filePath: "file.ts",
  beforeContent: "before",
  afterContent: "after",
  matchKinds: ["exact" as const],
  isNew: false
}];

test("approved apply creates checkpoint before writing and history after writing", async () => {
  const events: string[] = [];
  const checkpoint: Checkpoint = { id: "checkpoint", timestamp: 1, summary: "summary", files: [] };
  await applyApprovedRun(
    "root",
    "summary",
    "Low",
    changes,
    {
      create: async () => { events.push("checkpoint"); return checkpoint; },
      remove: async () => { events.push("remove"); }
    },
    { add: async () => { events.push("history"); } },
    async () => { events.push("write"); }
  );
  assert.deepEqual(events, ["checkpoint", "write", "history"]);
});

test("failed apply removes the unused checkpoint and does not create history", async () => {
  const events: string[] = [];
  const checkpoint: Checkpoint = { id: "checkpoint", timestamp: 1, summary: "summary", files: [] };
  await assert.rejects(applyApprovedRun(
    "root",
    "summary",
    "Low",
    changes,
    {
      create: async () => { events.push("checkpoint"); return checkpoint; },
      remove: async () => { events.push("remove"); }
    },
    { add: async () => { events.push("history"); } },
    async () => { events.push("write"); throw new Error("failed"); }
  ), /failed/);
  assert.deepEqual(events, ["checkpoint", "write", "remove"]);
});
