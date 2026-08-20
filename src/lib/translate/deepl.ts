import "server-only";

import { z } from "zod";

import { deeplApiUrl } from "@/lib/env";
import { engineKey } from "@/lib/secrets";
import { parseJsonResponse } from "@/lib/json-response";
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
  glossary: Set<string>;
  expiresAt: number;
};

type DeepLGlossaryState = {
  key: string;
  id?: string;
  idPromise?: Promise<string>;
  synced: Map<string, string>;
  pending: Map<string, Promise<string>>;
};

declare global {
  var __lctDeepLSupport: DeepLSupport | undefined;
  var __lctDeepLSupportPromise: Promise<DeepLSupport> | undefined;
  var __lctDeepLGlossary: DeepLGlossaryState | undefined;
}

const SUPPORT_TTL = 24 * 60 * 60 * 1_000;

const SOURCE_ALIASES = new Map<string, string>([
  ["fil", "TL"],
  ["no", "NB"],
  ["pt-BR", "PT"],
  ["zh-CN", "ZH"],
  ["zh-TW", "ZH"],
]);

const TARGET_ALIASES = new Map<string, string>([
  ["en", "EN-US"],
  ["fil", "TL"],
  ["no", "NB"],
  ["pt", "PT-PT"],
  ["pt-BR", "PT-BR"],
  ["zh-CN", "ZH-HANS"],
  ["zh-TW", "ZH-HANT"],
]);

const supportResponseSchema = z.array(z.object({
  lang: z.string(),
  usable_as_source: z.boolean().optional(),
  usable_as_target: z.boolean().optional(),
  features: z.object({ glossary: z.json().optional() }).optional(),
}));
const glossaryListSchema = z.object({
  glossaries: z.array(z.object({ glossary_id: z.string().optional(), name: z.string().optional() })),
});
const glossaryCreatedSchema = z.object({ glossary_id: z.string() });
const translationResponseSchema = z.object({
  translations: z.array(z.object({ text: z.string() })),
});

async function fetchSupport(key: string): Promise<DeepLSupport> {
  let response: Response;
  try {
    response = await fetch(`${deeplApiUrl(key)}/v3/languages?resource=translate_text`, {
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

  const payload = await parseJsonResponse(response, supportResponseSchema);
  if (!payload) {
    throw new TranslationError("DeepL 지원 언어 응답이 올바르지 않습니다", "deepl");
  }

  const source = new Set<string>();
  const target = new Set<string>();
  const glossary = new Set<string>();
  for (const item of payload) {
    const code = item.lang.toUpperCase();
    if (item.usable_as_source === true) source.add(code);
    if (item.usable_as_target === true) target.add(code);
    if (item.features?.glossary !== undefined) glossary.add(code);
  }
  return { source, target, glossary, expiresAt: Date.now() + SUPPORT_TTL };
}

async function loadSupport(): Promise<DeepLSupport> {
  const cached = globalThis.__lctDeepLSupport;
  if (cached && cached.expiresAt > Date.now()) return cached;
  if (globalThis.__lctDeepLSupportPromise) return globalThis.__lctDeepLSupportPromise;

  const key = engineKey("deepl");
  if (!key) throw new TranslationError("DeepL API 키가 등록되지 않았습니다", "deepl");

  globalThis.__lctDeepLSupportPromise = fetchSupport(key);

  try {
    return (globalThis.__lctDeepLSupport = await globalThis.__lctDeepLSupportPromise);
  } finally {
    delete globalThis.__lctDeepLSupportPromise;
  }
}

function languageCode(
  lang: LanguageCode,
  type: "source" | "target",
  supported: Set<string>,
) {
  const exact = lang.toUpperCase();
  if (supported.has(exact)) return exact;
  const alias = (type === "source" ? SOURCE_ALIASES : TARGET_ALIASES).get(lang);
  return alias && supported.has(alias) ? alias : undefined;
}

/** 한 요청에 넣을 문장 수. DeepL 은 요청당 50개까지 받는다. */
const BATCH_LIMIT = 40;

const GLOSSARY_NAME = "LiveConfTranslation";

function glossaryState(key: string): DeepLGlossaryState {
  const current = globalThis.__lctDeepLGlossary;
  if (current?.key === key) return current;
  return (globalThis.__lctDeepLGlossary = {
    key,
    synced: new Map(),
    pending: new Map(),
  });
}

async function glossaryId(
  key: string,
  sourceLang: string,
  targetLang: string,
  entries: string,
): Promise<string> {
  const state = glossaryState(key);
  if (state.id) return state.id;
  if (state.idPromise) return state.idPromise;

  state.idPromise = (async () => {
    const base = deeplApiUrl(key);
    const headers = { authorization: `DeepL-Auth-Key ${key}` };
    const listed = await fetch(`${base}/v3/glossaries`, { headers });
    if (!listed.ok) throw new Error(`DeepL 용어집 조회가 ${listed.status} 를 반환했습니다`);
    const payload = await parseJsonResponse(listed, glossaryListSchema);
    if (!payload) throw new Error("DeepL 용어집 목록 응답이 올바르지 않습니다");
    const existing = payload.glossaries.find(
      (item) => item.name === GLOSSARY_NAME && item.glossary_id,
    );
    if (existing?.glossary_id) return existing.glossary_id;

    const created = await fetch(`${base}/v3/glossaries`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        name: GLOSSARY_NAME,
        dictionaries: [
          {
            source_lang: sourceLang,
            target_lang: targetLang,
            entries,
            entries_format: "tsv",
          },
        ],
      }),
    });
    if (!created.ok) throw new Error(`DeepL 용어집 생성이 ${created.status} 를 반환했습니다`);
    const result = await parseJsonResponse(created, glossaryCreatedSchema);
    if (!result) throw new Error("DeepL 용어집 ID가 없습니다");
    return result.glossary_id;
  })();

  try {
    return (state.id = await state.idPromise);
  } finally {
    delete state.idPromise;
  }
}

async function ensureGlossary(
  key: string,
  sourceLang: string,
  targetLang: string,
  pairs: readonly { source: string; target: string }[],
): Promise<string | undefined> {
  if (!pairs.length) return undefined;
  const support = await loadSupport();
  if (!support.glossary.has(sourceLang) || !support.glossary.has(targetLang)) return undefined;

  const state = glossaryState(key);
  const pair = `${sourceLang}:${targetLang}`;
  const entries = pairs.map((item) => `${item.source}\t${item.target}`).join("\n");
  if (state.synced.get(pair) === entries && state.id) return state.id;
  const running = state.pending.get(pair);
  if (running) return running;

  const task = (async () => {
    const id = await glossaryId(key, sourceLang, targetLang, entries);
    const response = await fetch(`${deeplApiUrl(key)}/v3/glossaries/${id}/dictionaries`, {
      method: "PUT",
      headers: {
        authorization: `DeepL-Auth-Key ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        source_lang: sourceLang,
        target_lang: targetLang,
        entries,
        entries_format: "tsv",
      }),
    });
    if (!response.ok) throw new Error(`DeepL 용어집 동기화가 ${response.status} 를 반환했습니다`);
    state.synced.set(pair, entries);
    return id;
  })().finally(() => state.pending.delete(pair));

  state.pending.set(pair, task);
  return task;
}

/** DeepL 호출 한 번. 문장 배열을 받아 같은 순서로 돌려준다. */
async function callDeepl(
  texts: readonly string[],
  from: LanguageCode,
  to: LanguageCode,
  signal: AbortSignal | undefined,
  glossary: readonly { source: string; target: string }[] = [],
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

  let glossaryId: string | undefined;
  try {
    glossaryId = await ensureGlossary(key, sourceLang, targetLang, glossary);
  } catch (cause) {
    throw new TranslationError("DeepL 용어집을 동기화하지 못했습니다", "deepl", cause);
  }

  let response: Response;
  try {
    response = await fetch(`${deeplApiUrl(key)}/v2/translate`, {
      method: "POST",
      headers: {
        authorization: `DeepL-Auth-Key ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(Object.assign({
        text: texts,
        source_lang: sourceLang,
        target_lang: targetLang,
      }, glossaryId ? { glossary_id: glossaryId } : undefined)),
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

  const payload = await parseJsonResponse(response, translationResponseSchema);
  const translations = payload?.translations;

  if (!translations || translations.length !== texts.length) {
    throw new TranslationError("DeepL 응답의 번역문 개수가 요청과 다릅니다", "deepl");
  }

  return translations.map((item) => item.text);
}

export const deeplEngine: TranslationEngine = {
  id: "deepl",
  label: "DeepL",

  supports(lang: LanguageCode) {
    const support = globalThis.__lctDeepLSupport;
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

  async translate({ text, from, to, glossary, signal }: TranslateInput) {
    const [translated] = await callDeepl([text], from, to, signal, glossary);
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
