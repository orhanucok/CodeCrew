import test from "node:test";
import assert from "node:assert/strict";
import {
  clearHealthCache,
  healthCheck,
  healthFromError,
  refreshModelHealth
} from "../core/healthCheck";
import { OpenRouterError } from "../core/openrouterClient";

test("health check detects Ready and sends no project code", async () => {
  clearHealthCache();
  let prompt = "";
  const result = await healthCheck("key", "model", {
    force: true,
    now: 1000,
    clock: () => 1000,
    call: async (input) => {
      prompt = input.messages[0].content;
      return "OK";
    }
  });
  assert.equal(result.state, "Ready");
  assert.equal(prompt, "Reply with exactly: OK");
  assert.doesNotMatch(prompt, /workspace|selected code|project/i);
});

test("timeout becomes Failed", () => {
  assert.equal(healthFromError("model", new OpenRouterError("timeout", 408)).state, "Failed");
});

test("slow health response becomes Slow", async () => {
  clearHealthCache();
  let time = 1000;
  const result = await healthCheck("key", "slow-model", {
    force: true,
    clock: () => time,
    call: async () => {
      time = 8000;
      return "OK";
    }
  });
  assert.equal(result.state, "Slow");
});

test("429 and 503 respect Retry-After cooldown", () => {
  const rate = healthFromError("model", new OpenRouterError("rate", 429, 5000), 1000);
  const busy = healthFromError("model", new OpenRouterError("busy", 503, 3000), 1000);
  assert.equal(rate.state, "Cooldown");
  assert.equal(rate.cooldownUntil, 6000);
  assert.equal(busy.state, "Cooldown");
  assert.equal(busy.cooldownUntil, 4000);
});

test("429 without Retry-After is RateLimited and 503 is Busy", () => {
  assert.equal(healthFromError("model", new OpenRouterError("rate", 429)).state, "RateLimited");
  assert.equal(healthFromError("model", new OpenRouterError("busy", 503)).state, "Busy");
});

test("health results are cached for repeated checks", async () => {
  clearHealthCache();
  let calls = 0;
  const caller = async () => { calls++; return "OK"; };
  await healthCheck("cache-key", "model", { now: 1000, call: caller });
  await healthCheck("cache-key", "model", { now: 2000, call: caller });
  assert.equal(calls, 1);
});

test("refresh health checks each model once", async () => {
  clearHealthCache();
  let calls = 0;
  const results = await refreshModelHealth("key", ["a", "b"], async () => { calls++; return "OK"; });
  assert.equal(calls, 2);
  assert.equal(results.a.state, "Ready");
  assert.equal(results.b.state, "Ready");
});
