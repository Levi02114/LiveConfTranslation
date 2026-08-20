import "server-only";

import { z } from "zod";

import { isCatalogLanguage } from "@/lib/language-catalog";
import { parseJsonResponse } from "@/lib/json-response";
import type { LanguageCode } from "@/lib/languages";
import { engineKey } from "@/lib/secrets";

import {
  type BatchTranslateInput,
  TranslationError,
  type TranslateInput,
  type TranslationEngine,
} from "./types";

/**
 * Google Cloud Translation API v2.
 *
 * v3 가 아니라 v2 를 쓰는 이유: v2 는 API 키 하나로 호출되지만 v3 는 서비스 계정과
 * OAuth 토큰 발급이 필요하다. 로컬 네트워크에 띄우는 이 앱에는 v2 가 맞다.
 */

const ENDPOINT = "https://translation.googleapis.com/language/translate/v2";
const googleResponseSchema = z.object({
  data: z.object({ translations: z.array(z.object({ translatedText: z.string() })) }),
});

/**
 * Google 은 `format: "text"` 로 보내도 응답에 HTML 엔티티를 섞어 준다
 * (`'` → `&#39;`). 회의 로그에 `&#39;` 가 그대로 남으면 안 되므로 되돌린다.
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    // &amp; 는 다른 엔티티를 되살린 뒤 마지막에 처리해야 이중 디코딩이 안 생긴다.
    .replace(/&amp;/g, "&");
}

/** 한 요청에 넣을 문장 수. v2 는 요청당 세그먼트 수와 총 길이에 제한이 있다. */
const BATCH_LIMIT = 64;

/** Google 호출 한 번. 문장 배열을 받아 같은 순서로 돌려준다. */
async function callGoogle(
  texts: readonly string[],
  from: LanguageCode,
  to: LanguageCode,
  signal: AbortSignal | undefined,
): Promise<string[]> {
  const key = engineKey("google");
  if (!key) {
    throw new TranslationError("Google Translate API 키가 등록되지 않았습니다", "google");
  }

  let response: Response;
  try {
    response = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // q 에 배열을 주면 여러 문장을 한 번에 옮긴다. 응답도 같은 순서로 온다.
      body: JSON.stringify({ q: texts, source: from, target: to, format: "text" }),
      signal,
    });
  } catch (cause) {
    throw new TranslationError("Google 번역 서버에 연결하지 못했습니다", "google", cause);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new TranslationError(
      `Google 번역이 ${response.status} 를 반환했습니다${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      "google",
    );
  }

  const payload = await parseJsonResponse(response, googleResponseSchema);
  const translations = payload?.data.translations;
  if (!translations || translations.length !== texts.length) {
    throw new TranslationError("Google 번역 응답의 번역문 개수가 요청과 다릅니다", "google");
  }

  return translations.map((item) => decodeHtmlEntities(item.translatedText));
}

export const googleEngine: TranslationEngine = {
  id: "google",
  label: "Google Translate",

  /*
   * 예전에는 무조건 true 였다. 다루는 언어가 넷뿐일 때는 사실이었지만, 관리자가
   * 임의의 언어를 추가할 수 있게 된 지금은 거짓말이 된다.
   */
  supports(lang: LanguageCode) {
    return isCatalogLanguage(lang);
  },

  isConfigured() {
    return Boolean(engineKey("google"));
  },

  async translate({ text, from, to, signal }: TranslateInput) {
    const [translated] = await callGoogle([text], from, to, signal);
    return translated;
  },

  async translateBatch({ texts, from, to, signal }: BatchTranslateInput) {
    const out: string[] = [];

    for (let index = 0; index < texts.length; index += BATCH_LIMIT) {
      out.push(...(await callGoogle(texts.slice(index, index + BATCH_LIMIT), from, to, signal)));
    }

    return out;
  },
};
