import "server-only";

import { deeplApiUrl } from "@/lib/env";
import { engineKey } from "@/lib/secrets";
import type { LanguageCode } from "@/lib/languages";

import { TranslationError, type TranslateInput, type TranslationEngine } from "./types";

/**
 * DeepL API.
 *
 * ⚠️ DeepL 은 **싱할라어(si)를 지원하지 않는다.** 공식 지원 언어 목록에 없다.
 * 그래서 이 엔진은 `supports()` 로 자기 한계를 신고하고, 라우터(`./index.ts`)가
 * 지원하지 않는 언어를 Google 로 넘긴다.
 */

/** DeepL 이 받는 대문자 언어 코드. 여기 없으면 지원하지 않는 언어다. */
const DEEPL_LANG: Partial<Record<LanguageCode, string>> = {
  ko: "KO",
  vi: "VI",
  th: "TH",
  // si(싱할라어)는 의도적으로 비어 있다. DeepL 이 지원하지 않는다.
};

export const deeplEngine: TranslationEngine = {
  id: "deepl",
  label: "DeepL",

  supports(lang: LanguageCode) {
    return lang in DEEPL_LANG;
  },

  isConfigured() {
    return Boolean(engineKey("deepl"));
  },

  async translate({ text, from, to, signal }: TranslateInput) {
    const key = engineKey("deepl");
    if (!key) {
      throw new TranslationError("DEEPL_API_KEY 가 설정되지 않았습니다", "deepl");
    }

    const sourceLang = DEEPL_LANG[from];
    const targetLang = DEEPL_LANG[to];
    if (!sourceLang || !targetLang) {
      throw new TranslationError(
        `DeepL 은 ${!sourceLang ? from : to} 언어를 지원하지 않습니다`,
        "deepl",
      );
    }

    let response: Response;
    try {
      response = await fetch(`${deeplApiUrl(key)}/v2/translate`, {
        method: "POST",
        headers: {
          authorization: `DeepL-Auth-Key ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          text: [text],
          source_lang: sourceLang,
          target_lang: targetLang,
        }),
        signal,
      });
    } catch (cause) {
      throw new TranslationError("DeepL 서버에 연결하지 못했습니다", "deepl", cause);
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      // 456 은 이번 달 번역 한도 소진. 원인이 분명하니 그대로 알려 준다.
      const hint = response.status === 456 ? " (이번 달 번역 한도를 모두 썼습니다)" : "";
      throw new TranslationError(
        `DeepL 이 ${response.status} 를 반환했습니다${hint}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
        "deepl",
      );
    }

    const payload = (await response.json()) as { translations?: { text?: string }[] };

    const translated = payload.translations?.[0]?.text;
    if (typeof translated !== "string") {
      throw new TranslationError("DeepL 응답에 번역문이 없습니다", "deepl");
    }

    return translated;
  },
};
