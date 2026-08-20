import "server-only";

import type { LanguageCode } from "@/lib/languages";
import { listGlossaryPairs } from "@/lib/repo";

import { deeplEngine } from "./deepl";
import { googleEngine } from "./google";
import { openaiEngine } from "./openai";
import {
  type BatchTranslateInput,
  type EngineId,
  type TranslateInput,
  TranslationError,
  type TranslationEngine,
} from "./types";

export * from "./types";

const ENGINES = {
  google: googleEngine,
  deepl: deeplEngine,
  openai: openaiEngine,
} satisfies Record<EngineId, TranslationEngine>;

export function getEngine(id: EngineId): TranslationEngine {
  return ENGINES[id];
}

export function listEngines(): TranslationEngine[] {
  return [googleEngine, deeplEngine, openaiEngine];
}

/** 관리자 화면의 지원 여부가 실제 엔진 API 목록을 반영하도록 갱신한다. */
export async function refreshEngineSupport() {
  await Promise.allSettled(
    listEngines().flatMap((engine) =>
      engine.isConfigured() && engine.refreshSupport ? [engine.refreshSupport()] : [],
    ),
  );
}

async function engineProblem(
  engine: TranslationEngine,
  input: Pick<TranslateInput, "from" | "to">,
) {
  if (!engine.isConfigured()) return `${engine.label} 의 API 키가 설정되지 않았습니다`;

  try {
    await engine.refreshSupport?.();
  } catch (error) {
    return error instanceof Error ? error.message : `${engine.label} 지원 언어 조회에 실패했습니다`;
  }

  const unsupported = !engine.supports(input.from)
    ? input.from
    : !engine.supports(input.to)
      ? input.to
      : null;
  return unsupported ? `${engine.label} 은(는) ${unsupported} 언어를 지원하지 않습니다` : null;
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
 * 회의에 지정된 엔진으로 먼저 시도하되, 그 엔진이 해당 언어를 지원하지 않거나
 * 키가 없으면 회의에 선택한 폴백 엔진으로 넘긴다. 폴백은 선택 사항이다.
 * 어떤 엔진이 실제로 처리했는지 함께 돌려주어 로그에 남길 수 있게 한다.
 */
export async function translateText(
  preferred: EngineId,
  input: TranslateInput,
  fallback: EngineId | null = null,
): Promise<TranslateResult> {
  const engine = ENGINES[preferred];
  const enriched = { ...input, glossary: listGlossaryPairs(input.from, input.to) };

  const reason = await engineProblem(engine, enriched);
  if (reason) {
    if (!fallback || fallback === preferred) {
      throw new TranslationError(reason, preferred);
    }

    const fallbackEngine = ENGINES[fallback];
    const fallbackReason = await engineProblem(fallbackEngine, enriched);
    if (fallbackReason) {
      throw new TranslationError(`${reason}; 폴백 실패: ${fallbackReason}`, fallback);
    }

    const text = await fallbackEngine.translate(enriched);
    return { text, engine: fallback, fallbackReason: reason };
  }

  const text = await engine.translate(enriched);
  return { text, engine: preferred };
}

/**
 * 여러 문장을 한 번에 번역한다. UI 문구를 새 언어로 옮길 때 쓴다.
 *
 * UI 문구 번역은 회의와 달리 폴백 엔진을 고르지 않으므로, 선택한 엔진으로만
 * 돌린다. 배치 메서드가 없는 엔진은 한 문장씩 순차 호출로 메운다.
 */
export async function translateBatch(
  preferred: EngineId,
  input: BatchTranslateInput,
): Promise<string[]> {
  if (input.texts.length === 0) return [];

  const engine = ENGINES[preferred];
  const reason = await engineProblem(engine, input);
  if (reason) throw new TranslationError(reason, preferred);

  if (engine.translateBatch) return engine.translateBatch(input);

  // 배치를 지원하지 않는 엔진. 순서를 지켜야 하므로 순차로 돈다.
  const out: string[] = [];
  for (const text of input.texts) {
    out.push(
      await engine.translate({ text, from: input.from, to: input.to, signal: input.signal }),
    );
  }
  return out;
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
