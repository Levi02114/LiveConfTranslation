type FailureStrings = {
  failed: string;
  openaiBilling: string;
  openaiRateLimit: string;
};

/** 저장된 제공자 오류 코드를 현재 화면 언어의 안전한 안내로 바꾼다. */
export function translationFailureText(
  error: string | null | undefined,
  strings: FailureStrings,
): string {
  const normalized = error?.toLowerCase() ?? "";
  if (
    error === "openai-billing-limit" ||
    [
      "credit_balance_exhausted",
      "organization_spend_limit_exceeded",
      "project_spend_limit_exceeded",
      "organization_usage_limit_exceeded",
      "insufficient_quota",
      "current quota",
    ].some((marker) => normalized.includes(marker))
  ) return strings.openaiBilling;
  if (
    error === "openai-rate-limit" ||
    (normalized.includes("openai") && normalized.includes("429"))
  ) return strings.openaiRateLimit;
  return strings.failed;
}
