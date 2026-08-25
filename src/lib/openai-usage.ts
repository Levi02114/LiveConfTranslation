import { z } from "zod";

export const usagePeriodSchema = z.enum(["day", "week"]);
export type UsagePeriod = z.infer<typeof usagePeriodSchema>;

export const usagePeriodConfig = {
  day: { seconds: 24 * 60 * 60, bucketWidth: "1h", limit: 24 },
  week: { seconds: 7 * 24 * 60 * 60, bucketWidth: "1d", limit: 7 },
} as const satisfies Record<UsagePeriod, { seconds: number; bucketWidth: string; limit: number }>;

const usageResultSchema = z.object({
  model: z.string().nullable().optional(),
  input_tokens: z.number().nonnegative().optional().default(0),
  input_cached_tokens: z.number().nonnegative().optional().default(0),
  input_uncached_tokens: z.number().nonnegative().optional(),
  input_cache_write_tokens: z.number().nonnegative().optional().default(0),
  output_tokens: z.number().nonnegative().optional().default(0),
  num_model_requests: z.number().nonnegative().optional().default(0),
});

export const openaiUsageResponseSchema = z.object({
  data: z.array(z.object({ results: z.array(usageResultSchema).optional().default([]) })),
});

export type OpenaiUsageRow = {
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  requests: number;
  estimatedCostUsd: number | null;
};

type ModelPricing = {
  ids: readonly string[];
  input: number;
  cached?: number;
  cacheWrite?: number;
  output: number;
};

/** OpenAI 공식 Standard 요금, 2026-08-25 확인. 단위는 USD / 100만 토큰. */
const MODEL_PRICING: readonly ModelPricing[] = [
  { ids: ["gpt-4o-transcribe-diarize"], input: 2.5, output: 10 },
  { ids: ["gpt-4o-mini-transcribe"], input: 1.25, output: 5 },
  { ids: ["gpt-4o-transcribe"], input: 2.5, output: 10 },
  { ids: ["gpt-5.6-sol", "gpt-5.6"], input: 4, cached: 0.4, cacheWrite: 5, output: 20 },
  { ids: ["gpt-5.6-terra"], input: 2, cached: 0.2, cacheWrite: 2.5, output: 12 },
  { ids: ["gpt-5.6-luna"], input: 0.2, cached: 0.02, cacheWrite: 0.25, output: 1.2 },
  { ids: ["gpt-5.4-mini"], input: 0.75, cached: 0.075, output: 4.5 },
  { ids: ["gpt-5.4-nano"], input: 0.2, cached: 0.02, output: 1.25 },
  { ids: ["gpt-5.4"], input: 2.5, cached: 0.25, output: 15 },
  { ids: ["gpt-4o-mini"], input: 0.15, cached: 0.075, output: 0.6 },
  { ids: ["gpt-4o"], input: 2.5, cached: 1.25, output: 10 },
];

type UsageTotals = Omit<OpenaiUsageRow, "estimatedCostUsd"> & {
  uncachedInputTokens: number;
  cacheWriteTokens: number;
};

function estimateCost(row: UsageTotals): number | null {
  const pricing = MODEL_PRICING.find(({ ids }) =>
    ids.some((id) => row.model === id || (id !== "gpt-5.6" && row.model.startsWith(`${id}-`))),
  );
  if (!pricing) return null;
  if (row.cachedInputTokens > 0 && pricing.cached === undefined) return null;
  if (row.cacheWriteTokens > 0 && pricing.cacheWrite === undefined) return null;

  return (
    row.uncachedInputTokens * pricing.input +
    row.cachedInputTokens * (pricing.cached ?? 0) +
    row.cacheWriteTokens * (pricing.cacheWrite ?? 0) +
    row.outputTokens * pricing.output
  ) / 1_000_000;
}

export function aggregateOpenaiUsage(
  payload: z.input<typeof openaiUsageResponseSchema>,
): OpenaiUsageRow[] {
  const parsed = openaiUsageResponseSchema.parse(payload);
  const totals = new Map<string, UsageTotals>();

  for (const bucket of parsed.data) {
    for (const result of bucket.results) {
      const model = result.model ?? "unknown";
      const current = totals.get(model) ?? {
        model,
        inputTokens: 0,
        cachedInputTokens: 0,
        uncachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 0,
        requests: 0,
      };
      current.inputTokens += result.input_tokens;
      current.cachedInputTokens += result.input_cached_tokens;
      current.uncachedInputTokens += result.input_uncached_tokens
        ?? Math.max(0, result.input_tokens - result.input_cached_tokens - result.input_cache_write_tokens);
      current.cacheWriteTokens += result.input_cache_write_tokens;
      current.outputTokens += result.output_tokens;
      current.requests += result.num_model_requests;
      totals.set(model, current);
    }
  }

  return [...totals.values()]
    .map(({ uncachedInputTokens, cacheWriteTokens, ...row }) => ({
      ...row,
      estimatedCostUsd: estimateCost({ ...row, uncachedInputTokens, cacheWriteTokens }),
    }))
    .sort((a, b) => b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens));
}
