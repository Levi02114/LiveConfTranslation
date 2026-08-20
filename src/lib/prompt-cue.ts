import type { LanguageCode } from "@/lib/languages";
import { getLanguagePromptCue, upsertLanguagePromptCue } from "@/lib/repo";
import { builtinStyleCue, STYLE_CUE_SOURCE } from "@/lib/translate/prompt";
import type { EngineId } from "@/lib/translate/types";

declare global {
  var __promptCuePending: Map<LanguageCode, Promise<string | null>> | undefined;
  var __promptCueFailed: Set<LanguageCode> | undefined;
}

const pending = (globalThis.__promptCuePending ??= new Map());
const failed = (globalThis.__promptCueFailed ??= new Set());

export function resolveLanguagePromptCue(lang: LanguageCode): string | null {
  return getLanguagePromptCue(lang)?.text ?? builtinStyleCue(lang);
}

export async function refreshLanguagePromptCue(
  lang: LanguageCode,
  engine: EngineId,
  generate: () => Promise<string>,
): Promise<string> {
  try {
    const text = (await generate()).trim();
    if (!text) throw new Error("번역 프롬프트 문체 지시문이 비어 있습니다");
    if (lang.toLowerCase().split("-")[0] !== "en" && text === STYLE_CUE_SOURCE) {
      throw new Error("번역 프롬프트 문체 지시문이 영어 원문 그대로입니다");
    }
    upsertLanguagePromptCue(lang, text, engine);
    failed.delete(lang);
    return text;
  } catch (error) {
    failed.add(lang);
    throw error;
  }
}

/** 동적 언어 지시문은 프로세스당 한 번만 생성하고, 실패하면 영어 규칙으로 계속한다. */
export async function ensureLanguagePromptCue(
  lang: LanguageCode,
  generate: () => Promise<string>,
): Promise<string | null> {
  const cached = resolveLanguagePromptCue(lang);
  if (cached || failed.has(lang)) return cached;

  const running = pending.get(lang);
  if (running) return running;

  const task = refreshLanguagePromptCue(lang, "openai", generate)
    .catch((error) => {
      console.warn(
        `[prompt-cue] ${lang} 문체 지시문을 생성하지 못해 영어 규칙만 사용합니다:`,
        error instanceof Error ? error.message : error,
      );
      return null;
    })
    .finally(() => pending.delete(lang));

  pending.set(lang, task);
  return task;
}
