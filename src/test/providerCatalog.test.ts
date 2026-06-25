import test from "node:test";
import assert from "node:assert/strict";
import { candidateFromRemote } from "../core/modelCatalog";

test("OpenRouter filtering excludes safety, embedding, audio, image, and vision-only models", () => {
  for (const id of [
    "nvidia/content-safety:free",
    "vendor/text-embedding:free",
    "vendor/whisper-audio:free",
    "vendor/image-generation:free",
    "vendor/vl-vision-only:free"
  ]) {
    assert.equal(candidateFromRemote({ id, name: id, pricing: { prompt: "0", completion: "0" } }), undefined);
  }
});

test("OpenRouter filtering keeps coding and instruct models", () => {
  assert.ok(candidateFromRemote({
    id: "qwen/qwen-coder:free",
    name: "Qwen Coder",
    pricing: { prompt: "0", completion: "0" },
    architecture: { output_modalities: ["text"] }
  }));
  assert.ok(candidateFromRemote({
    id: "meta/llama-instruct:free",
    name: "Llama Instruct",
    pricing: { prompt: "0", completion: "0" },
    architecture: { output_modalities: ["text"] }
  }));
});
