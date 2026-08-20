import { z } from "zod";

import { configuredLocalTranslationModel, ensureLocalTranslationRuntime, localTranslationConfigured } from "@/lib/local-runtime";

import { TranslationError, type TranslateInput, type TranslationEngine } from "./types";

const SUPPORTED = new Set([
  "am", "ar", "bg", "bn", "cs", "da", "de", "el", "en", "es", "et", "fa", "fi",
  "fr", "gu", "he", "hi", "hr", "hu", "id", "it", "ja", "km", "kn", "ko", "lo",
  "lt", "lv", "ml", "mr", "ms", "my", "ne", "nl", "no", "pa", "pl", "pt", "ro",
  "ru", "sk", "sl", "sr", "sv", "sw", "ta", "te", "th", "tl", "tr", "uk", "ur",
  "vi", "zh",
]);
const responseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })),
});

function code(value: string): string {
  const locale = value.replaceAll("_", "-");
  if (locale.toLowerCase().startsWith("zh-")) {
    return /(?:hant|tw|hk|mo)/i.test(locale) ? "zh-Hant" : "zh";
  }
  return locale.toLowerCase().split("-")[0];
}

function clean(text: string): string {
  return text.trim().replace(/^(translation|translated text|번역)\s*[:：]\s*/i, "");
}

async function translate(input: TranslateInput): Promise<string> {
  const origin = await ensureLocalTranslationRuntime();
  let response: Response;
  try {
    response = await fetch(`${origin}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: configuredLocalTranslationModel() ?? "local",
        messages: [{ role: "user", content: input.text }],
        chat_template_kwargs: {
          source_lang_code: code(input.from),
          target_lang_code: code(input.to),
        },
        temperature: 0,
        max_tokens: 1024,
      }),
      signal: input.signal,
    });
  } catch (cause) {
    throw new TranslationError("로컬 번역 모델에 연결하지 못했습니다", "local", cause);
  }
  if (!response.ok) {
    throw new TranslationError(`로컬 번역 모델이 ${response.status}를 반환했습니다`, "local");
  }
  const parsed = responseSchema.safeParse(await response.json().catch(() => null));
  const output = parsed.success ? clean(parsed.data.choices[0]?.message.content ?? "") : "";
  if (!output) throw new TranslationError("로컬 번역 결과가 비어 있습니다", "local");
  return output;
}

export const localEngine: TranslationEngine = {
  id: "local",
  label: "Local AI (TranslateGemma)",
  supports(lang) {
    return SUPPORTED.has(code(lang));
  },
  isConfigured: localTranslationConfigured,
  translate,
};
