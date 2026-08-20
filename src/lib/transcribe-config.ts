/**
 * 실시간 전사 세션 파라미터를 만드는 곳.
 *
 * 단일 언어 입력·캡처(WebRTC 또는 태국어 서버 WebSocket)와 통합 입력(서버
 * WebSocket 릴레이)이 같은 규칙을 쓰도록 한 모듈에 모은다. 커스텀
 * 서버(server.ts)도 불러오므로
 * `server-only`·`next/headers` 를 넣지 않는다.
 */
import { getLanguage, type LanguageCode } from "@/lib/languages";
import { listGlossaryEntries } from "@/lib/repo";
import { singleTranscriptionProfile } from "@/lib/transcription-profile";

/**
 * OpenAI 실시간 전사 API가 `languages` 힌트로 받는 코드(2026-08 실측).
 *
 * 목록 밖의 코드를내면 세션 설정이 통째로 거부된다 — 기본 언어인 si 가
 * 대표적이라, 힌트를 그대로내면 싱할라어 세션은 물론 si 를 포함한 통합
 * 세션까지 전부 실패한다. 미지원 언어는 힌트에서 빼고 자동 감지에 맡긴다.
 */
export const TRANSCRIBE_HINT_LANGS: readonly string[] = [
  "af", "ar", "az", "be", "bg", "bs", "ca", "cs", "cy", "da", "de", "el", "en",
  "es", "et", "fa", "fi", "fr", "gl", "he", "hi", "hr", "hu", "hy", "id", "is",
  "it", "iw", "ja", "kk", "kn", "ko", "lt", "lv", "mi", "mk", "mr", "ms", "ne",
  "nl", "no", "pl", "pt", "ro", "ru", "sk", "sl", "sr", "sv", "sw", "ta", "th",
  "tl", "tr", "uk", "ur", "vi", "zh",
];

export type TranscribeSessionParams = {
  model: string;
  /** API 에 그대로 보낼 언어 힌트. 비어 있으면 필드를 생략한다(자동 감지). */
  languages: string[];
  keywords: string[];
  /**
   * gpt-live-transcribe 만 받는 지연 단계. gpt-transcribe 에 내면 세션이
   * 거부되므로 통합 입력에서는 생략한다.
   */
  delay?: "minimal" | "low" | "medium" | "high" | "xhigh";
  prompt: string;
  noiseReduction: "near_field" | "far_field";
};

export type TranscribeHintLangs = {
  supported: LanguageCode[];
  unsupported: LanguageCode[];
};

/** 힌트로 보낼 수 있는 코드만 남긴다. 지원 여부는 소문자 기준으로 본다. */
export function splitTranscribeHintLangs(codes: readonly LanguageCode[]): TranscribeHintLangs {
  const supported: LanguageCode[] = [];
  const unsupported: LanguageCode[] = [];
  for (const code of codes) {
    // 지원 여부는 기본 하위 태그(zh-CN → zh)로 판별한다.
    const primary = code.toLowerCase().split("-")[0];
    (TRANSCRIBE_HINT_LANGS.includes(primary) ? supported : unsupported).push(code);
  }
  return { supported, unsupported };
}

function glossaryTermsFor(langs: readonly LanguageCode[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of listGlossaryEntries()) {
    for (const lang of langs) {
      const term = entry.terms[lang]?.trim();
      if (!term || /[\r\n<>]/.test(term)) continue;
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(term);
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/**
 * 언어별 전사 지시문. 정확도에 직접 영향이 있는 철자·표기 규칙만 담는다.
 * 기본 4개 언어는 검수한 문구를 쓰고, 관리자가 추가한 언어는 일반 규칙로 돌아간다.
 */
function languageCue(lang: LanguageCode): string {
  const primary = lang.toLowerCase().split("-")[0];
  switch (primary) {
    case "ko":
      return "Write standard Korean (한국어) orthography with correct word spacing (띄어쓰기). Keep honorifics and sentence endings exactly as spoken. Write numbers, dates, and amounts as spoken.";
    case "vi":
      return "Write Vietnamese (Tiếng Việt) with complete and correct diacritics and tone marks — never drop or guess tone marks. Keep numbers, names, and loanwords exactly as spoken.";
    case "th":
      return "Write Thai (ไทย) in standard Thai script with no spaces between words. Keep polite particles (ครับ/ค่ะ) and numbers exactly as spoken.";
    case "si":
      return "Write Sinhala (සිංහල) in Sinhala script with standard spelling. Keep numbers, names, and loanwords exactly as spoken.";
    default:
      return `Write ${getLanguage(lang).logName} (${lang}) in its standard written form, preserving exact wording.`;
  }
}

const SHARED_RULES =
  "Transcribe every intelligible spoken word, including brief acknowledgements and hesitations. " +
  "Preserve wording, names, numbers, and terminology. " +
  "Never summarize, translate, answer, invent speaker labels, or add unspoken text.";

function cleanTitle(title: string): string {
  return title.replace(/\s+/g, " ").trim().slice(0, 160);
}

/** 화자 이름은 프롬프트에 따옴표 안에 들어가므로 따옴표·줄바꿈을 걷어 낸다. */
function cleanName(name: string): string {
  return name.replace(/["\r\n]/g, " ").replace(/\s+/g, " ").trim().slice(0, 40);
}

/**
 * 언어별 단일 입력 모델. 실측 평가(.tmp/eval, 2026-08)에서 th 는 gpt-transcribe 가
 * CER 0.8% 대 gpt-live-transcribe 3.5% 로 확실히 앞섰고, ko 는 오차 범위,
 * vi 는 오히려 나빠졌다(18.2% vs 9.7%). 여기 없는 언어는 gpt-live-transcribe.
 */
/** 단일 언어 입력·캡처 페이지용. 언어를 고정하고 그 언어의 용어집만 힌트로 준다. */
export function buildSingleSessionParams(
  lang: LanguageCode,
  title: string,
  options: { farField?: boolean; context?: string | null; speaker?: string | null } = {},
): TranscribeSessionParams {
  const { supported } = splitTranscribeHintLangs([lang]);
  const context = options.context?.replace(/\s+/g, " ").trim().slice(0, 300);
  const speaker = options.speaker ? cleanName(options.speaker) : "";
  const { model } = singleTranscriptionProfile(lang);
  return {
    model,
    languages: supported.map((code) => code.toLowerCase().split("-")[0]),
    keywords: glossaryTermsFor([lang], 100),
    // 실측 평가(.tmp/eval)에서 xhigh 가 si CER 를 35.6%→13.4% 로 줄였고
    // ko/vi/th 는 오차 범위였다. gpt-transcribe 는 delay 를 받지 않는다(세션 거부).
    delay: model === "gpt-live-transcribe" ? "xhigh" : undefined,
    prompt:
      `Live meeting title/context: "${cleanTitle(title)}". ` +
      (context ? `Additional context: "${context}". ` : "") +
      // 화자 이름 철자는 전사 모델이 가장 많이 틀리는 부분이라 직접 알려 준다.
      (speaker ? `The current speaker's name is "${speaker}" — spell it exactly this way. ` : "") +
      `The spoken language is ${getLanguage(lang).logName} (${lang}). ${languageCue(lang)} ${SHARED_RULES}`,
    noiseReduction: options.farField ? "far_field" : "near_field",
  };
}

/**
 * 통합 입력 페이지용. 후보 언어 전체를 힌트로 주고 언어 감지에 맡긴다.
 * 용어집은 페이지 기본 언어 것을 먼저 채운다.
 */
export function buildCombinedSessionParams(
  langs: readonly LanguageCode[],
  pageLang: LanguageCode,
  title: string,
  options: { context?: string | null; speaker?: string | null } = {},
): TranscribeSessionParams {
  const { supported, unsupported } = splitTranscribeHintLangs(langs);
  if (unsupported.length) {
    console.warn(
      `[transcribe] 언어 힌트 미지원 코드를 뺍니다: ${unsupported.join(", ")} (자동 감지로 동작)`,
    );
  }
  const ordered = [pageLang, ...langs.filter((lang) => lang !== pageLang)];
  const context = options.context?.replace(/\s+/g, " ").trim().slice(0, 300);
  const speaker = options.speaker ? cleanName(options.speaker) : "";
  const cues = langs.map((lang) => languageCue(lang)).join(" ");
  // si 처럼 힌트를 못 넣는 언어는 프롬프트에만 적는다 — 프롬프트 고정만으로도
  // 자동 감지 정확도가 크게 오른다(실측: si 단일 세션 CER 17.4%).
  const expectedList = langs
    .map((lang) => `${getLanguage(lang).logName} (${lang})`)
    .join(", ");
  return {
    model: "gpt-transcribe",
    languages: supported.map((code) => code.toLowerCase().split("-")[0]),
    keywords: glossaryTermsFor(ordered, 100),
    prompt:
      `Live session title/context: "${cleanTitle(title)}". ` +
      (context ? `Additional context: "${context}". ` : "") +
      (speaker ? `The current speaker's name is "${speaker}" — spell it exactly this way. ` : "") +
      `Expected languages: ${expectedList}. Detect which one is spoken in each turn. ` +
      `${cues} ${SHARED_RULES}`,
    noiseReduction: "near_field",
  };
}
