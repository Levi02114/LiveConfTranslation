import "server-only";

import { deeplApiUrl } from "@/lib/env";
import { engineKey } from "@/lib/secrets";
import type { LanguageCode } from "@/lib/languages";

import {
  type BatchTranslateInput,
  TranslationError,
  type TranslateInput,
  type TranslationEngine,
} from "./types";

type DeepLSupport = {
  source: Set<string>;
  target: Set<string>;
  expiresAt: number;
};

type DeepLGlobal = typeof globalThis & {
  __lctDeepLSupport?: DeepLSupport;
  __lctDeepLSupportPromise?: Promise<DeepLSupport>;
};

const supportGlobal = globalThis as DeepLGlobal;
const SUPPORT_TTL = 24 * 60 * 60 * 1_000;

const SOURCE_ALIASES: Record<string, string> = {
  fil: "TL",
  no: "NB",
  "pt-BR": "PT",
  "zh-CN": "ZH",
  "zh-TW": "ZH",
};

const TARGET_ALIASES: Record<string, string> = {
  en: "EN-US",
  fil: "TL",
  no: "NB",
  pt: "PT-PT",
  "pt-BR": "PT-BR",
  "zh-CN": "ZH-HANS",
  "zh-TW": "ZH-HANT",
};

async function fetchLanguages(type: "source" | "target", key: string): Promise<Set<string>> {
  let response: Response;
  try {
    response = await fetch(`${deeplApiUrl(key)}/v2/languages?type=${type}`, {
      headers: { authorization: `DeepL-Auth-Key ${key}` },
    });
  } catch (cause) {
    throw new TranslationError("DeepL 지원 언어 목록을 불러오지 못했습니다", "deepl", cause);
  }

  if (!response.ok) {
    throw new TranslationError(
      `DeepL 지원 언어 조회가 ${response.status} 를 반환했습니다`,
      "deepl",
    );
  }

  const payload = (await response.json()) as { language?: unknown }[];
  if (!Array.isArray(payload)) {
    throw new TranslationError("DeepL 지원 언어 응답이 올바르지 않습니다", "deepl");
  }
  return new Set(
    payload.flatMap((item) => (typeof item.language === "string" ? [item.language] : [])),
  );
}

async function loadSupport(): Promise<DeepLSupport> {
  const cached = supportGlobal.__lctDeepLSupport;
  if (cached && cached.expiresAt > Date.now()) return cached;
  if (supportGlobal.__lctDeepLSupportPromise) return supportGlobal.__lctDeepLSupportPromise;

  const key = engineKey("deepl");
  if (!key) throw new TranslationError("DeepL API 키가 등록되지 않았습니다", "deepl");

  supportGlobal.__lctDeepLSupportPromise = Promise.all([
    fetchLanguages("source", key),
    fetchLanguages("target", key),
  ]).then(([source, target]) => ({ source, target, expiresAt: Date.now() + SUPPORT_TTL }));

  try {
    return (supportGlobal.__lctDeepLSupport = await supportGlobal.__lctDeepLSupportPromise);
  } finally {
    delete supportGlobal.__lctDeepLSupportPromise;
  }
}

function languageCode(
  lang: LanguageCode,
  type: "source" | "target",
  supported: Set<string>,
) {
  const exact = lang.toUpperCase();
  if (supported.has(exact)) return exact;
  const alias = (type === "source" ? SOURCE_ALIASES : TARGET_ALIASES)[lang];
  return alias && supported.has(alias) ? alias : undefined;
}

/** 한 요청에 넣을 문장 수. DeepL 은 요청당 50개까지 받는다. */
const BATCH_LIMIT = 40;

/** DeepL 호출 한 번. 문장 배열을 받아 같은 순서로 돌려준다. */
async function callDeepl(
  texts: readonly string[],
  from: LanguageCode,
  to: LanguageCode,
  signal: AbortSignal | undefined,
): Promise<string[]> {
  const key = engineKey("deepl");
  if (!key) {
    throw new TranslationError("DeepL API 키가 등록되지 않았습니다", "deepl");
  }

  const support = await loadSupport();
  const sourceLang = languageCode(from, "source", support.source);
  const targetLang = languageCode(to, "target", support.target);
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
        text: texts,
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
  const translations = payload.translations;

  if (!translations || translations.length !== texts.length) {
    throw new TranslationError("DeepL 응답의 번역문 개수가 요청과 다릅니다", "deepl");
  }

  return translations.map((item) => {
    if (typeof item.text !== "string") {
      throw new TranslationError("DeepL 응답에 번역문이 없습니다", "deepl");
    }
    return item.text;
  });
}

export const deeplEngine: TranslationEngine = {
  id: "deepl",
  label: "DeepL",

  supports(lang: LanguageCode) {
    const support = supportGlobal.__lctDeepLSupport;
    return Boolean(
      support &&
        languageCode(lang, "source", support.source) &&
        languageCode(lang, "target", support.target),
    );
  },

  async refreshSupport() {
    await loadSupport();
  },

  isConfigured() {
    return Boolean(engineKey("deepl"));
  },

  async translate({ text, from, to, signal }: TranslateInput) {
    const [translated] = await callDeepl([text], from, to, signal);
    return translated;
  },

  async translateBatch({ texts, from, to, signal }: BatchTranslateInput) {
    const out: string[] = [];

    for (let index = 0; index < texts.length; index += BATCH_LIMIT) {
      out.push(...(await callDeepl(texts.slice(index, index + BATCH_LIMIT), from, to, signal)));
    }

    return out;
  },
};
