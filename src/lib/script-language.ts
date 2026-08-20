/**
 * 전사 텍스트의 유니코드 문자 영역으로 언어를 추정한다.
 *
 * 통합 입력에서 모델의 언어 감지(`languages[0].code`)는 짧은 발화에서 흔들린다.
 * 한글·태국어·싱할라어는 문자 영역 자체가 언어를 증명하므로, 모델 감지와
 * 충돌할 때 문자 증거를 우선한다. 라틴 계열은 문자만으로 안전하게 구분할 수 없어
 * 모델 감지를 그대로 쓴다.
 */
import type { LanguageCode } from "@/lib/languages";

const RANGES: readonly { lang: string; re: RegExp }[] = [
  { lang: "ko", re: /[\uAC00-\uD7A3\u1100-\u11FF\u3130-\u318F]/g },
  { lang: "th", re: /[\u0E00-\u0E7F]/g },
  { lang: "si", re: /[\u0D80-\u0DFF]/g },
];

/**
 * 텍스트에 해당 언어의 고유 문자가 있는지 본다.
 * - true: 문자 증거가 있다(감지와 일치).
 * - false: 고유 문자가 하나도 없다 — 감지가 틀렸을 가능성이 크다.
 * - null: 그 언어는 문자로 검증할 수 없다(베트남어 등 라틴 계열).
 */
export function hasScriptEvidence(text: string, lang: LanguageCode): boolean | null {
  const primary = lang.toLowerCase().split("-")[0];
  const range = RANGES.find((row) => row.lang === primary);
  if (!range) return null;
  // RANGES 의 정규식은 g 플래그라 test() 가 lastIndex 를 오염시킨다 — 새로 만든다.
  return new RegExp(range.re.source).test(text);
}

/**
 * 텍스트의 문자 증거가 가리키는 세션 언어. 증거가 없거나 후보에 없으면 null.
 * `candidates` 는 세션의 입력 언어 코드 목록이다.
 */
export function scriptLanguageOf(
  text: string,
  candidates: readonly LanguageCode[],
): LanguageCode | null {
  let winner: string | null = null;
  let winnerCount = 0;
  for (const { lang, re } of RANGES) {
    const count = text.match(re)?.length ?? 0;
    if (count > winnerCount) {
      winner = lang;
      winnerCount = count;
    }
  }
  if (!winner) return null;

  // 가장 많이 나온 문자 영역을 고른다. 후보에 있는 코드만 인정한다.
  const match = candidates.find(
    (code) => code.toLowerCase().split("-")[0] === winner,
  );
  return match ?? null;
}
