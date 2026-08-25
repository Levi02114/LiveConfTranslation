import assert from "node:assert/strict";
import test from "node:test";

import { aggregateOpenaiUsage } from "@/lib/openai-usage";

test("OpenAI 일별 버킷을 모델별 토큰과 예상 비용으로 합친다", () => {
  const [row] = aggregateOpenaiUsage({
    data: [
      {
        results: [
          { model: "gpt-5.6-luna", input_tokens: 1_000_000, input_cached_tokens: 200_000, input_uncached_tokens: 700_000, input_cache_write_tokens: 100_000, output_tokens: 100_000, num_model_requests: 4 },
        ],
      },
      {
        results: [
          { model: "gpt-5.6-luna", input_tokens: 100_000, input_cached_tokens: 0, input_uncached_tokens: 100_000, input_cache_write_tokens: 0, output_tokens: 0, num_model_requests: 1 },
        ],
      },
    ],
  });

  assert.deepEqual(row, {
    model: "gpt-5.6-luna",
    inputTokens: 1_100_000,
    cachedInputTokens: 200_000,
    outputTokens: 100_000,
    requests: 5,
    estimatedCostUsd: 0.309,
  });

  const costs = new Map(aggregateOpenaiUsage({
    data: [{ results: [
      { model: "gpt-5.6-sol", input_tokens: 1_000_000, output_tokens: 1_000_000 },
      { model: "gpt-4o-2024-08-06", input_tokens: 1_000_000, output_tokens: 1_000_000 },
      { model: "gpt-4o-transcribe-diarize", input_tokens: 1_000_000, output_tokens: 1_000_000 },
      { model: "gpt-5.4-mini-2026-03-17", input_tokens: 1_000_000, output_tokens: 1_000_000 },
      { model: "gpt-4o-transcribe", input_tokens: 1_000_000, output_tokens: 1_000_000 },
    ] }],
  }).map((item) => [item.model, item.estimatedCostUsd]));
  assert.equal(costs.get("gpt-5.6-sol"), 24);
  assert.equal(costs.get("gpt-4o-2024-08-06"), 12.5);
  assert.equal(costs.get("gpt-4o-transcribe-diarize"), 12.5);
  assert.equal(costs.get("gpt-5.4-mini-2026-03-17"), 5.25);
  assert.equal(costs.get("gpt-4o-transcribe"), 12.5);
});
