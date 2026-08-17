import "server-only";

import { openaiBaseUrl } from "@/lib/env";
import { ensureLanguagePromptCue } from "@/lib/prompt-cue";
import { engineKey, resolveOpenaiModel } from "@/lib/secrets";
import { type LanguageCode, languageLogName } from "@/lib/languages";

import {
  type BatchTranslateInput,
  TranslationError,
  type TranslateInput,
  type TranslationEngine,
} from "./types";
import { hasHangulLeak } from "./quality";
import { STYLE_CUE_SOURCE, targetLanguageRules } from "./prompt";

type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * OpenAI 모델을 쓰는 LLM 번역.
 *
 * 기계 번역과 다른 점은 **직전 발언을 문맥으로 넘길 수 있다**는 것이다. 회의에서는
 * "그건", "아까 말씀하신" 같은 표현이 계속 나오는데 문장 단위 번역기는 이걸 못 푼다.
 *
 * 대신 LLM 은 시키지 않은 말을 덧붙이는 경향이 있어(설명, 따옴표, "번역:" 머리말)
 * 프롬프트로 강하게 막고, 그래도 새면 후처리로 걷어 낸다.
 */

/** LLM 이 습관적으로 붙이는 껍데기를 걷어 낸다. */
function stripWrapper(text: string): string {
  let output = text.trim();

  // "Translation:" / "번역:" 류의 머리말
  output = output.replace(/^(translation|translated text|번역)\s*[:：]\s*/i, "");

  // 전체를 감싼 따옴표 (원문에 따옴표가 있으면 짝이 맞지 않으므로 양끝만 본다)
  const quoted = /^(["'“”「『])([\s\S]*)(["'“”」』])$/.exec(output);
  if (quoted) output = quoted[2].trim();

  return output;
}

function buildSystemPrompt(
  from: LanguageCode,
  to: LanguageCode,
  styleCue: string | null,
): string {
  const source = { logName: languageLogName(from) };
  const target = { logName: languageLogName(to) };

  return [
    `You translate live session transcripts from ${source.logName} into ${target.logName}.`,
    "",
    "Rules:",
    `- Output ONLY the ${target.logName} translation. No preamble, no notes, no quotation marks around the whole output.`,
    "- Never explain or comment. Never ask questions. Never refuse.",
    "- Preserve the speaker's tone and register. Produce natural spoken language, not a literal gloss.",
    "- Keep numbers, dates, units, and proper nouns accurate.",
    "- When the languages use different scripts, transliterate names and unfamiliar text into the target script. Do not copy source-script characters.",
    "- The declared source language can be wrong. Translate the actual input text instead of copying text in an unexpected script.",
    ...targetLanguageRules(to, styleCue).map((rule) => `- ${rule}`),
    "- Earlier lines may be supplied as context. Use them only to resolve pronouns and keep terminology consistent — never translate them.",
    `- If the input is already in ${target.logName}, return it unchanged.`,
  ].join("\n");
}

function buildPromptCueSystemPrompt(to: LanguageCode, count?: number): string {
  const target = languageLogName(to);
  return [
    `Translate the supplied English instruction into ${target} for use inside a machine-translation system prompt.`,
    "Preserve its exact requirements while using concise, natural wording in the target language.",
    ...targetLanguageRules(to),
    count
      ? `Return ONLY JSON: {"items": [...]} with exactly ${count} strings, in the same order as the input.`
      : `Return ONLY the ${target} translation. No preamble, notes, or quotation marks around the whole output.`,
  ].join("\n");
}

/**
 * UI 문구 전용 프롬프트.
 *
 * 회의 발화용 프롬프트를 그대로 쓰면 "저장" 이 "이것을 저장하십시오" 같은
 * 문장으로 늘어나 버튼을 뚫고 나간다. 라벨이라는 사실을 분명히 말해 준다.
 */
function buildUiSystemPrompt(to: LanguageCode, count: number): string {
  const target = languageLogName(to);

  return [
    `You translate user-interface strings for a live session-translation web app from Korean into ${target}.`,
    "",
    "Rules:",
    "- These are UI labels: buttons, headings, input placeholders, short status messages.",
    "- Keep them SHORT. A label must still fit inside the same button. Never expand a label into a sentence.",
    "- Match the register of the source: terse, neutral, no honorific padding.",
    "- Do not add punctuation the source does not have.",
    "- Keep product and key names as-is: API, DeepL, OpenAI, Google Translate, Enter, Shift.",
    "- Keep placeholder tokens such as {count}, {engine}, and {languages} exactly unchanged.",
    `- Return ONLY JSON: {"items": [...]} with exactly ${count} strings, in the same order as the input.`,
    ...targetLanguageRules(to).map((rule) => `- ${rule}`),
  ].join("\n");
}

async function requestChat(
  messages: ChatMessage[],
  signal?: AbortSignal,
  json = false,
): Promise<string> {
  const key = engineKey("openai");
  if (!key) {
    throw new TranslationError("OpenAI API 키가 등록되지 않았습니다", "openai");
  }

  let response: Response;
  try {
    response = await fetch(`${openaiBaseUrl()}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: resolveOpenaiModel(),
        messages,
        ...(json ? { response_format: { type: "json_object" } } : {}),
      }),
      signal,
    });
  } catch (cause) {
    throw new TranslationError("OpenAI 에 연결하지 못했습니다", "openai", cause);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const hint = response.status === 429 ? " (요청 한도 초과)" : "";
    throw new TranslationError(
      `OpenAI 가 ${response.status} 를 반환했습니다${hint}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      "openai",
    );
  }

  const payload = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new TranslationError("OpenAI 응답에 번역문이 없습니다", "openai");
  }
  return content;
}

async function meetingStyleCue(to: LanguageCode, signal?: AbortSignal) {
  return ensureLanguagePromptCue(to, async () =>
    stripWrapper(
      await requestChat(
        [
          { role: "system", content: buildPromptCueSystemPrompt(to) },
          { role: "user", content: STYLE_CUE_SOURCE },
        ],
        signal,
      ),
    ),
  );
}

export const openaiEngine: TranslationEngine = {
  id: "openai",
  label: "OpenAI (LLM)",

  // LLM 은 대상 4개 언어를 모두 다룬다. 싱할라어도 포함이다.
  supports() {
    return true;
  },

  isConfigured() {
    return Boolean(engineKey("openai"));
  },

  async translate({ text, from, to, context, signal }: TranslateInput) {
    const userContent = context?.length
      ? `<context_do_not_translate>\n${context.join("\n")}\n</context_do_not_translate>\n\n<translate>\n${text}\n</translate>`
      : text;

    const styleCue = await meetingStyleCue(to, signal);
    const messages: ChatMessage[] = [
      { role: "system", content: buildSystemPrompt(from, to, styleCue) },
      { role: "user", content: userContent },
    ];
    const first = stripWrapper(await requestChat(messages, signal));
    if (!hasHangulLeak(first, to)) return first;

    const corrected = stripWrapper(
      await requestChat(
        [
          ...messages,
          { role: "assistant", content: first },
          {
            role: "user",
            content: `Your answer violated the zero-Hangul constraint. Rewrite the original input entirely in ${languageLogName(to)} using its target writing system. Translate every Korean span; transliterate names if needed. Return only the corrected translation with zero Hangul characters.`,
          },
        ],
        signal,
      ),
    );

    if (hasHangulLeak(corrected, to)) {
      throw new TranslationError("OpenAI 번역에 한국어 원문이 남았습니다", "openai");
    }
    return corrected;
  },

  /**
   * 여러 문장을 한 요청으로.
   *
   * UI 문구 90여 개를 한 문장씩 보내면 LLM 왕복만 90번이라 몇 분이 걸린다.
   * JSON 으로 주고받아 한 번에 끝낸다.
   */
  async translateBatch({ texts, from, to, kind, signal }: BatchTranslateInput) {
    if (texts.length === 0) return [];

    const system =
      kind === "ui"
        ? buildUiSystemPrompt(to, texts.length)
        : kind === "prompt"
          ? buildPromptCueSystemPrompt(to, texts.length)
          : `${buildSystemPrompt(from, to, await meetingStyleCue(to, signal))}\n\nReturn ONLY JSON: {"items": [...]} with exactly ${texts.length} strings, same order as the input.`;

    // 개수와 순서를 지켜야 하므로 자유 서술을 막고 JSON 으로 못 박는다.
    const content = await requestChat(
      [
        { role: "system", content: system },
        { role: "user", content: JSON.stringify({ items: texts }) },
      ],
      signal,
      true,
    );

    let items: unknown;
    try {
      items = (JSON.parse(content) as { items?: unknown }).items;
    } catch (cause) {
      throw new TranslationError("OpenAI 응답을 JSON 으로 읽지 못했습니다", "openai", cause);
    }

    if (!Array.isArray(items) || items.length !== texts.length) {
      throw new TranslationError(
        `OpenAI 가 ${texts.length}개를 요청했는데 ${Array.isArray(items) ? items.length : 0}개를 돌려주었습니다`,
        "openai",
      );
    }

    return items.map((item, index) =>
      typeof item === "string" && item.trim() ? stripWrapper(item) : texts[index],
    );
  },
};
