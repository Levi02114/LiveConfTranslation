import "server-only";

import { resolveEntries, sourceEntries } from "@/lib/i18n";
import type { LanguageCode } from "@/lib/languages";
import { getUiStrings, upsertUiStrings } from "@/lib/repo";
import { translateBatch } from "@/lib/translate";
import type { EngineId } from "@/lib/translate/types";

/**
 * UI 문구를 통째로 한 언어로 옮긴다.
 *
 * 언어를 추가할 때 한 번, 「다시 번역」을 누를 때 한 번 돈다. 한국어 원문
 * 90여 개가 출발점이다(`lib/i18n.ts` 의 `sourceEntries()`).
 *
 * **실패해도 전부 잃지 않는다.** 뭉치 단위로 나눠 보내고 실패한 뭉치만 건너뛴다.
 * 빠진 키는 화면에서 한국어로 나온다 — 해석기가 키 단위로 폴백하기 때문이다.
 * 90개를 한 번에 보내다가 하나 때문에 전부 날리는 것보다 낫다.
 */

/**
 * 한 번에 보낼 문장 수.
 *
 * 엔진도 나름대로 쪼개지만 여기서 한 번 더 나누는 이유는 **실패를 가두기**
 * 위해서다. LLM 은 개수를 어기는 일이 있는데, 그때 잃는 게 30개면 충분히 작다.
 */
const CHUNK = 30;

export type UiTranslationResult = {
  /** 실제로 저장된 문구 수 */
  translated: number;
  /** 번역하지 못해 한국어로 남는 문구 수 */
  failed: number;
};

export type UiTranslationOptions = {
  /**
   * 관리자가 손으로 고친 문구(`origin = 'manual'`)를 건드리지 않는다.
   *
   * 「다시 번역」이 사람이 고쳐 놓은 것을 지워 버리면 그 기능을 쓸 수 없다.
   */
  keepManual?: boolean;
  /** 코드 업데이트 뒤 새로 생겨 한국어로 폴백 중인 키만 채운다. */
  missingOnly?: boolean;
};

export async function translateUiStrings(
  lang: LanguageCode,
  engine: EngineId,
  options: UiTranslationOptions = {},
): Promise<UiTranslationResult> {
  // 한국어가 원문이다. 자기 자신으로 옮길 일은 없다.
  if (lang === "ko") return { translated: 0, failed: 0 };

  let entries = sourceEntries().filter((entry) => entry.source.trim());

  if (options.missingOnly) {
    const missing = new Set(
      resolveEntries(lang)
        .filter((entry) => entry.origin === "fallback")
        .map((entry) => entry.key),
    );
    entries = entries.filter((entry) => missing.has(entry.key));
  }

  if (options.keepManual) {
    const manual = new Set(
      getUiStrings(lang)
        .filter((row) => row.origin === "manual")
        .map((row) => row.key),
    );
    entries = entries.filter((entry) => !manual.has(entry.key));
  }

  let translated = 0;
  let failed = 0;

  for (let index = 0; index < entries.length; index += CHUNK) {
    const chunk = entries.slice(index, index + CHUNK);

    try {
      const results = await translateBatch(engine, {
        texts: chunk.map((entry) => entry.source),
        from: "ko",
        to: lang,
        kind: "ui",
      });

      const rows = chunk
        .map((entry, offset) => ({
          key: entry.key,
          text: (results[offset] ?? "").trim(),
          origin: "machine" as const,
        }))
        .filter((row) => row.text);

      upsertUiStrings(lang, rows);
      translated += rows.length;
      failed += chunk.length - rows.length;
    } catch (error) {
      // 뭉치 하나가 실패해도 나머지는 계속 간다. 빠진 키는 한국어로 나온다.
      failed += chunk.length;
      console.warn(
        `[ui-translate] ${lang} 문구 ${chunk.length}개를 번역하지 못했습니다:`,
        error instanceof Error ? error.message : error,
      );
    }
  }

  return { translated, failed };
}
