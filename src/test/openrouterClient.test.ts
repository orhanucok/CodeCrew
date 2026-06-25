import test from "node:test";
import assert from "node:assert/strict";
import { messageForStatus, parseRetryAfter } from "../core/openrouterClient";

test("Retry-After supports seconds and HTTP dates", () => {
  assert.equal(parseRetryAfter("5", 1000), 5000);
  assert.equal(parseRetryAfter("Thu, 01 Jan 1970 00:00:10 GMT", 1000), 9000);
  assert.equal(parseRetryAfter("invalid", 1000), undefined);
});

test("OpenRouter status codes map to safe user-facing messages", () => {
  assert.equal(messageForStatus(401), "Your OpenRouter API key is invalid. Please update it in CodeCrew settings.");
  assert.equal(messageForStatus(402), "OpenRouter account or credit issue. Free models may be unavailable until the account is fixed.");
  assert.equal(messageForStatus(429), "Free coding model is busy. Trying fallback.");
  assert.equal(messageForStatus(503), "Free coding model is busy. Trying fallback.");
  assert.doesNotMatch(messageForStatus(500), /stack|provider response|json/i);
});
