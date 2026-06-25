import test from "node:test";
import assert from "node:assert/strict";
import { mapWithConcurrency } from "../core/providers/providerHealthCache";

test("provider health work is limited to two concurrent checks", async () => {
  let active = 0;
  let maximum = 0;
  await mapWithConcurrency([1, 2, 3, 4, 5], 2, async (value) => {
    active++;
    maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active--;
    return value;
  });
  assert.equal(maximum, 2);
});
