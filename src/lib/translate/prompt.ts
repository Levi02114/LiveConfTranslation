import { type LanguageCode, languageLogName } from "@/lib/languages";

const scriptNames = new Intl.DisplayNames(["en"], { type: "script", fallback: "code" });

/** BCP-47 언어 코드에서 대상 언어의 표기 체계를 자동으로 만든다. */
export function targetLanguageRules(to: LanguageCode): string[] {
  const target = languageLogName(to);
  let writingSystem = `Use natural ${target} with its standard writing system and orthography.`;

  try {
    const scriptCode = new Intl.Locale(to).maximize().script;
    if (scriptCode) {
      const script = scriptNames.of(scriptCode) ?? scriptCode;
      writingSystem = `Use natural ${target} written in its ${script} (${scriptCode}) script with standard orthography; preserve every required accent, diacritic, and script-specific mark.`;
    }
  } catch {
    // ICU 가 모르는 코드여도 범용 지시문은 남긴다.
  }

  if (to.toLowerCase().split("-")[0] === "ko") return [writingSystem];
  return [
    writingSystem,
    "HARD CONSTRAINT: The final answer must contain zero Hangul characters. Translate every Korean span; transliterate names into the target writing system when they have no translation.",
  ];
}
