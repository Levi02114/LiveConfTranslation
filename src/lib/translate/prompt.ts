import { type LanguageCode, languageLogName } from "@/lib/languages";

const scriptNames = new Intl.DisplayNames(["en"], { type: "script", fallback: "code" });

export const STYLE_CUE_SOURCE =
  "Write the translation in natural, idiomatic language as it would be spoken by a native speaker in a live meeting. Preserve the speaker's tone, register, and level of formality. Return only the translation.";

const BUILTIN_STYLE_CUES: Readonly<Record<string, string>> = {
  ko: "실시간 세션에서 원어민이 실제로 말하듯 자연스럽고 관용적인 한국어로 번역하세요. 화자의 어조, 말투와 격식 수준을 유지하고 번역문만 출력하세요.",
  vi: "Hãy dịch bằng tiếng Việt tự nhiên và giàu tính thành ngữ như cách người bản ngữ thực sự nói trong một cuộc họp trực tiếp. Giữ nguyên giọng điệu, cách diễn đạt và mức độ trang trọng của người nói. Chỉ trả về bản dịch.",
  th: "แปลเป็นภาษาไทยที่เป็นธรรมชาติและเป็นสำนวนเหมือนที่เจ้าของภาษาใช้พูดจริงในการประชุมสด รักษาน้ำเสียง ระดับภาษา และความเป็นทางการของผู้พูด และแสดงเฉพาะคำแปลเท่านั้น",
  si: "සජීවී රැස්වීමකදී ස්වදේශික කථිකයෙකු සැබවින්ම කතා කරන ආකාරයට ස්වාභාවික හා ව්‍යවහාරික සිංහලයට පරිවර්තනය කරන්න. කථිකයාගේ ස්වරය, භාෂා මට්ටම සහ විධිමත්භාවය රැකගෙන පරිවර්තනය පමණක් ලබා දෙන්න.",
};

export function builtinStyleCue(lang: LanguageCode): string | null {
  return lang === "en" ? STYLE_CUE_SOURCE : (BUILTIN_STYLE_CUES[lang] ?? null);
}

/** BCP-47 언어 코드에서 대상 언어의 표기 체계를 자동으로 만든다. */
export function targetLanguageRules(to: LanguageCode, styleCue?: string | null): string[] {
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

  const rules =
    to.toLowerCase().split("-")[0] === "ko"
      ? [writingSystem]
      : [
          writingSystem,
          "HARD CONSTRAINT: The final answer must contain zero Hangul characters. Translate every Korean span; transliterate names into the target writing system when they have no translation.",
        ];

  if (styleCue?.trim()) rules.push(styleCue.trim());
  return rules;
}
