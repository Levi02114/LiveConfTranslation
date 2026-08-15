import "server-only";

import { openaiBaseUrl, openaiApiKey, openaiModel } from "@/lib/env";
import { getLanguage, type LanguageCode } from "@/lib/languages";

import { TranslationError, type TranslateInput, type TranslationEngine } from "./types";

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

function buildSystemPrompt(from: LanguageCode, to: LanguageCode): string {
  const source = getLanguage(from);
  const target = getLanguage(to);

  return [
    `You translate live meeting transcripts from ${source.logName} into ${target.logName}.`,
    "",
    "Rules:",
    `- Output ONLY the ${target.logName} translation. No preamble, no notes, no quotation marks around the whole output.`,
    "- Never explain or comment. Never ask questions. Never refuse.",
    "- Preserve the speaker's tone and register. Produce natural spoken language, not a literal gloss.",
    "- Keep numbers, dates, units, and proper nouns accurate.",
    "- Earlier lines may be supplied as context. Use them only to resolve pronouns and keep terminology consistent — never translate them.",
    `- If the input is already in ${target.logName}, return it unchanged.`,
  ].join("\n");
}

export const openaiEngine: TranslationEngine = {
  id: "openai",
  label: "OpenAI (LLM)",

  // LLM 은 대상 4개 언어를 모두 다룬다. 싱할라어도 포함이다.
  supports() {
    return true;
  },

  isConfigured() {
    return Boolean(openaiApiKey());
  },

  async translate({ text, from, to, context, signal }: TranslateInput) {
    const key = openaiApiKey();
    if (!key) {
      throw new TranslationError("OPENAI_API_KEY 가 설정되지 않았습니다", "openai");
    }

    const userContent = context?.length
      ? `<context_do_not_translate>\n${context.join("\n")}\n</context_do_not_translate>\n\n<translate>\n${text}\n</translate>`
      : text;

    let response: Response;
    try {
      response = await fetch(`${openaiBaseUrl()}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: openaiModel(),
          messages: [
            { role: "system", content: buildSystemPrompt(from, to) },
            { role: "user", content: userContent },
          ],
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

    return stripWrapper(content);
  },
};
