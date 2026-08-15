import type { LanguageCode } from "@/lib/languages";

export type EngineId = "google" | "deepl" | "openai";

export const ENGINE_IDS: readonly EngineId[] = ["google", "deepl", "openai"] as const;

export function isEngineId(value: unknown): value is EngineId {
  return typeof value === "string" && (ENGINE_IDS as readonly string[]).includes(value);
}

export type TranslateInput = {
  text: string;
  from: LanguageCode;
  to: LanguageCode;
  /**
   * 직전 발언들의 원문.
   *
   * LLM 엔진이 대명사와 용어를 맞추는 데 쓴다. 기계 번역 엔진(google, deepl)은
   * 문장 단위로만 동작하므로 무시한다.
   */
  context?: readonly string[];
  signal?: AbortSignal;
};

export interface TranslationEngine {
  readonly id: EngineId;
  readonly label: string;
  /**
   * 이 엔진이 해당 언어를 다룰 수 있는지.
   *
   * 엔진마다 지원 언어가 다르다는 사실을 호출하는 쪽이 알 필요가 없도록,
   * 엔진 자신이 신고하게 한다.
   */
  supports(lang: LanguageCode): boolean;
  /** API 키가 설정되어 실제로 호출 가능한 상태인지 */
  isConfigured(): boolean;
  translate(input: TranslateInput): Promise<string>;
}

/** 번역 실패를 호출부에서 구분할 수 있게 하는 오류 타입 */
export class TranslationError extends Error {
  constructor(
    message: string,
    readonly engine: EngineId,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TranslationError";
  }
}
