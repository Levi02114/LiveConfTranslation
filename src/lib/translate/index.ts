import "server-only";

import type { LanguageCode } from "@/lib/languages";

import { deeplEngine } from "./deepl";
import { googleEngine } from "./google";
import { openaiEngine } from "./openai";
import {
  type EngineId,
  type TranslateInput,
  TranslationError,
  type TranslationEngine,
} from "./types";

export * from "./types";

const ENGINES: Record<EngineId, TranslationEngine> = {
  google: googleEngine,
  deepl: deeplEngine,
  openai: openaiEngine,
};

/** 선택한 엔진이 못 하는 언어를 떠넘길 곳. Google 은 4개 언어를 모두 지원한다. */
const FALLBACK_ENGINE: EngineId = "google";

export function getEngine(id: EngineId): TranslationEngine {
  return ENGINES[id];
}

export function listEngines(): TranslationEngine[] {
  return [googleEngine, deeplEngine, openaiEngine];
}

export type TranslateResult = {
  text: string;
  /** 실제로 번역을 수행한 엔진. 폴백이 일어나면 요청한 엔진과 다르다. */
  engine: EngineId;
  /** 폴백이 일어났다면 그 이유 */
  fallbackReason?: string;
};

/**
 * 회의용 번역 진입점.
 *
 * 회의에 지정된 엔진으로 먼저 시도하되, 그 엔진이 해당 언어를 지원하지 않으면
 * Google 로 넘긴다. DeepL 이 싱할라어를 못 하기 때문에 반드시 필요한 경로다.
 * 어떤 엔진이 실제로 처리했는지 함께 돌려주어 로그에 남길 수 있게 한다.
 */
export async function translateText(
  preferred: EngineId,
  input: TranslateInput,
): Promise<TranslateResult> {
  const engine = ENGINES[preferred];

  const unsupported = !engine.supports(input.from) || !engine.supports(input.to);
  const unconfigured = !engine.isConfigured();

  if (unsupported || unconfigured) {
    const fallback = ENGINES[FALLBACK_ENGINE];
    const reason = unsupported
      ? `${engine.label} 은(는) ${engine.supports(input.from) ? input.to : input.from} 언어를 지원하지 않습니다`
      : `${engine.label} 의 API 키가 설정되지 않았습니다`;

    if (preferred === FALLBACK_ENGINE || !fallback.isConfigured()) {
      throw new TranslationError(reason, preferred);
    }

    const text = await fallback.translate(input);
    return { text, engine: FALLBACK_ENGINE, fallbackReason: reason };
  }

  const text = await engine.translate(input);
  return { text, engine: preferred };
}

/** 관리자 화면에서 "이 언어 조합을 이 엔진으로 돌릴 수 있는가"를 보여주기 위한 헬퍼 */
export function engineCoverage(id: EngineId, langs: readonly LanguageCode[]) {
  const engine = ENGINES[id];
  const unsupported = langs.filter((lang) => !engine.supports(lang));
  return {
    engine: engine.id,
    label: engine.label,
    configured: engine.isConfigured(),
    unsupported,
  };
}
