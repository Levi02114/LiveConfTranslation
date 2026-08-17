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

/**
 * 여러 문장을 한 번에 번역할 때 쓰는 입력.
 *
 * UI 문구를 새 언어로 옮기는 데 쓴다(90여 개). 한 문장씩 보내면 LLM 엔진은
 * 왕복만 90번이라 몇 분이 걸린다.
 */
export type BatchTranslateInput = {
  texts: readonly string[];
  from: LanguageCode;
  to: LanguageCode;
  /**
   * 무엇을 번역하는지.
   *
   * `ui` 는 버튼·라벨이라 짧게 유지해야 하고 존댓말 문장으로 늘어나면 안 된다.
   * `prompt` 는 대상 언어 문체 지시문 자체를 번역하므로 그 지시문을 재귀 적용하지 않는다.
   * 프롬프트를 쓰는 LLM 엔진만 이 값을 본다.
   */
  kind?: "meeting" | "ui" | "prompt";
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
  /** 엔진 API가 제공하는 최신 지원 언어를 로드한다. */
  refreshSupport?(): Promise<void>;
  /** API 키가 설정되어 실제로 호출 가능한 상태인지 */
  isConfigured(): boolean;
  translate(input: TranslateInput): Promise<string>;
  /**
   * 여러 문장을 한 요청으로 번역한다.
   *
   * 선택 사항이다. 없는 엔진은 `translateEach()`(`./index.ts`)가 한 문장씩
   * 순차 호출로 메워 준다. **입력과 같은 길이·같은 순서**로 돌려주어야 한다.
   */
  translateBatch?(input: BatchTranslateInput): Promise<string[]>;
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
