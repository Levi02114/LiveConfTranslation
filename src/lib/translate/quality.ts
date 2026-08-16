import type { LanguageCode } from "@/lib/languages";

/** 대상 언어가 한국어가 아닌데 결과에 한글이 남았는지 본다. */
export function hasHangulLeak(text: string, to: LanguageCode): boolean {
  return to.toLowerCase().split("-")[0] !== "ko" && /\p{Script=Hangul}/u.test(text);
}
