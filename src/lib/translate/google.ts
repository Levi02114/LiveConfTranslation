import "server-only";

import { engineKey } from "@/lib/secrets";

import { TranslationError, type TranslateInput, type TranslationEngine } from "./types";

/**
 * Google Cloud Translation API v2.
 *
 * v3 가 아니라 v2 를 쓰는 이유: v2 는 API 키 하나로 호출되지만 v3 는 서비스 계정과
 * OAuth 토큰 발급이 필요하다. 로컬 네트워크에 띄우는 이 앱에는 v2 가 맞다.
 */

const ENDPOINT = "https://translation.googleapis.com/language/translate/v2";

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

export const googleEngine: TranslationEngine = {
  id: "google",
  label: "Google 번역",

  // 대상 4개 언어를 모두 지원한다.
  supports() {
    return true;
  },

  isConfigured() {
    return Boolean(engineKey("google"));
  },

  async translate({ text, from, to, signal }: TranslateInput) {
    const key = engineKey("google");
    if (!key) {
      throw new TranslationError(
        "GOOGLE_TRANSLATE_API_KEY 가 설정되지 않았습니다",
        "google",
      );
    }

    let response: Response;
    try {
      response = await fetch(`${ENDPOINT}?key=${encodeURIComponent(key)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ q: text, source: from, target: to, format: "text" }),
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

    const payload = (await response.json()) as {
      data?: { translations?: { translatedText?: string }[] };
    };

    const translated = payload.data?.translations?.[0]?.translatedText;
    if (typeof translated !== "string") {
      throw new TranslationError("Google 번역 응답에 번역문이 없습니다", "google");
    }

    return decodeHtmlEntities(translated);
  },
};
