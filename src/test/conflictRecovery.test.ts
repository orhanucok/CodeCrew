import test from "node:test";
import assert from "node:assert/strict";
import { FILE_CHANGED_MESSAGE, REFRESH_AND_RETRY, shouldStartNewRun } from "../core/conflictRecovery";

test("Refresh and retry starts a new run while Cancel does not", () => {
  assert.match(FILE_CHANGED_MESSAGE, /regenerate the patch/);
  assert.equal(shouldStartNewRun(REFRESH_AND_RETRY), true);
  assert.equal(shouldStartNewRun("Cancel"), false);
  assert.equal(shouldStartNewRun(undefined), false);
});
