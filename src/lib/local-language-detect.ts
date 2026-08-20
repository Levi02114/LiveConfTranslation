import { matchDetectedLanguage } from "@/lib/detected-language";
import type { LanguageCode } from "@/lib/languages";
import { scriptLanguageOf } from "@/lib/script-language";

type FastTextLike = { predict(text: string, limit?: number, threshold?: number): Map<string, number> };
export type LocalLanguagePrediction = { lang: LanguageCode | null; confidence: number };

declare global {
  var __fastTextLanguageModel: Promise<FastTextLike> | undefined;
}

async function model(): Promise<FastTextLike> {
  return (globalThis.__fastTextLanguageModel ??= import("fasttext.wasm").then(async ({ FastText }) => {
    const instance = await FastText.create();
    await instance.loadModel();
    return instance;
  }));
}

export function selectLocalPrediction(
  predictions: ReadonlyMap<string, number>,
  candidates: readonly LanguageCode[],
  threshold = 0.55,
): LocalLanguagePrediction {
  const sorted = [...predictions].sort((a, b) => b[1] - a[1]);
  for (const [label, confidence] of sorted) {
    const lang = matchDetectedLanguage(label.replace(/^__label__/, ""), candidates);
    if (lang) return { lang: confidence >= threshold ? lang : null, confidence };
  }
  return { lang: null, confidence: 0 };
}

export async function detectLocalTextLanguage(
  text: string,
  candidates: readonly LanguageCode[],
): Promise<LocalLanguagePrediction> {
  const scripted = scriptLanguageOf(text, candidates);
  if (scripted) return { lang: scripted, confidence: 1 };
  return selectLocalPrediction((await model()).predict(text, 8, 0), candidates);
}
