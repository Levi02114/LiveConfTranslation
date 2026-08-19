import type { LanguageCode } from "@/lib/languages";

/** 제공자가 돌려준 코드를 세션의 실제 입력 언어 코드로 제한한다. */
export function matchDetectedLanguage(
  detected: string | null | undefined,
  candidates: readonly LanguageCode[],
): LanguageCode | null {
  const value = detected?.trim().toLowerCase();
  if (!value) return null;

  const exact = candidates.find((code) => code.toLowerCase() === value);
  if (exact) return exact;

  const primary = value.split("-")[0];
  const matches = candidates.filter((code) => code.toLowerCase().split("-")[0] === primary);
  return matches.length === 1 ? matches[0] : null;
}
