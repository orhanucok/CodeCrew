import test from "node:test";
import assert from "node:assert/strict";
import {
  CANCEL,
  DIRTY_FILE_MESSAGE,
  ensureSavedBeforeGeneration,
  SAVE_AND_CONTINUE
} from "../core/dirtyFileGuard";

test("clean files continue without prompting", async () => {
  let prompted = false;
  await ensureSavedBeforeGeneration(
    { isDirty: false, save: async () => true },
    async () => { prompted = true; return CANCEL; }
  );
  assert.equal(prompted, false);
});

test("dirty files show the exact Save and continue prompt and save before generation", async () => {
  let saved = false;
  await ensureSavedBeforeGeneration(
    { isDirty: true, save: async () => { saved = true; return true; } },
    async (message, ...buttons) => {
      assert.equal(message, DIRTY_FILE_MESSAGE);
      assert.deepEqual(buttons, [SAVE_AND_CONTINUE, CANCEL]);
      return SAVE_AND_CONTINUE;
    }
  );
  assert.equal(saved, true);
});

test("dirty-file cancellation or failed save stops generation", async () => {
  await assert.rejects(ensureSavedBeforeGeneration(
    { isDirty: true, save: async () => true },
    async () => CANCEL
  ), /Cancelled/);
  await assert.rejects(ensureSavedBeforeGeneration(
    { isDirty: true, save: async () => false },
    async () => SAVE_AND_CONTINUE
  ), /Cancelled/);
});
