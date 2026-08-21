import { z } from "zod";

import { ensureLocalTranslationRuntime, localTranslationConfigured } from "@/lib/local-runtime";

import { TranslationError, type TranslateInput, type TranslationEngine } from "./types";

const responseSchema = z.object({ content: z.string() });
const englishNames = new Intl.DisplayNames(["en"], { type: "language" });

function code(value: string): string {
  const locale = value.replaceAll("_", "-");
  try {
    return new Intl.Locale(locale).toString();
  } catch {
    return locale;
  }
}

function clean(text: string): string {
  return text.trim().replace(/^(translation|translated text|번역)\s*[:：]\s*/i, "");
}

export function localTranslationRequest(input: Pick<TranslateInput, "text" | "from" | "to">) {
  const sourceCode = code(input.from);
  const targetCode = code(input.to);
  const sourceName = englishNames.of(sourceCode) ?? sourceCode;
  const targetName = englishNames.of(targetCode) ?? targetCode;
  return {
    prompt: `<start_of_turn>user\nYou are a professional ${sourceName} (${sourceCode}) to ${targetName} (${targetCode}) translator. Your goal is to accurately convey the meaning and nuances of the original ${sourceName} text while adhering to ${targetName} grammar, vocabulary, and cultural sensitivities.\nProduce only the ${targetName} translation, without any additional explanations or commentary. Please translate the following ${sourceName} text into ${targetName}:\n\n\n${input.text.trim()}<end_of_turn>\n<start_of_turn>model\n`,
    temperature: 0,
    n_predict: 1024,
    stop: ["<end_of_turn>"],
  };
}

async function translate(input: TranslateInput): Promise<string> {
  const origin = await ensureLocalTranslationRuntime();
  let response: Response;
  try {
    response = await fetch(`${origin}/completion`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(localTranslationRequest(input)),
      signal: input.signal,
    });
  } catch (cause) {
    throw new TranslationError("로컬 번역 모델에 연결하지 못했습니다", "local", cause);
  }
  if (!response.ok) {
    throw new TranslationError(`로컬 번역 모델이 ${response.status}를 반환했습니다`, "local");
  }
  const parsed = responseSchema.safeParse(await response.json().catch(() => null));
  const output = parsed.success ? clean(parsed.data.content) : "";
  if (!output) throw new TranslationError("로컬 번역 결과가 비어 있습니다", "local");
  return output;
}

export const localEngine: TranslationEngine = {
  id: "local",
  label: "Local AI (TranslateGemma)",
  supports() {
    // TranslateGemma에는 모델을 로드하지 않고 물을 지원 언어 API가 없다. 불완전한 수동 목록으로
    // 등록 언어를 미리 막지 않고 실제 모델 응답으로 성공 여부를 판단한다.
    return true;
  },
  isConfigured: localTranslationConfigured,
  translate,
};
