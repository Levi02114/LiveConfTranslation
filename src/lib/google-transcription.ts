import { createHash } from "node:crypto";

import { v2 as speech } from "@google-cloud/speech";

import type { LanguageCode } from "@/lib/languages";
import { googleSpeechCredentials } from "@/lib/secrets";

const LOCATION = "asia-southeast1";
const GOOGLE_LOCALES = new Map([
  ["ko", "ko-KR"],
  ["vi", "vi-VN"],
  ["th", "th-TH"],
  ["si", "si-LK"],
  ["zh", "cmn-Hans-CN"],
  ["zh-cn", "cmn-Hans-CN"],
  ["zh-tw", "cmn-Hant-TW"],
]);

declare global {
  var __liveConfGoogleSpeechClient:
    | { projectId: string; clientEmail: string; credentialHash: string; client: speech.SpeechClient }
    | undefined;
}

/** 앱의 짧은 언어 코드를 Chirp 2가 받는 지역 포함 코드로 바꾼다. */
export function googleSpeechLocale(code: LanguageCode): string {
  const normalized = code.toLowerCase();
  const known = GOOGLE_LOCALES.get(normalized);
  if (known) return known;
  if (code.includes("-")) return code;
  try {
    const locale = new Intl.Locale(code).maximize();
    return locale.region ? `${locale.language}-${locale.region}` : code;
  } catch {
    return code;
  }
}

function clientFor(credentials: NonNullable<ReturnType<typeof googleSpeechCredentials>>) {
  const cached = globalThis.__liveConfGoogleSpeechClient;
  const credentialHash = createHash("sha256").update(credentials.private_key).digest("hex");
  if (
    cached?.projectId === credentials.project_id &&
    cached.clientEmail === credentials.client_email &&
    cached.credentialHash === credentialHash
  ) return cached.client;

  void cached?.client.close();
  const client = new speech.SpeechClient({
    projectId: credentials.project_id,
    credentials: {
      client_email: credentials.client_email,
      private_key: credentials.private_key,
    },
    apiEndpoint: `${LOCATION}-speech.googleapis.com`,
  });
  globalThis.__liveConfGoogleSpeechClient = {
    projectId: credentials.project_id,
    clientEmail: credentials.client_email,
    credentialHash,
    client,
  };
  return client;
}

export async function transcribeGooglePcm(input: {
  pcm: Buffer;
  lang: LanguageCode;
  keywords?: readonly string[];
}): Promise<{ body: string; lang: LanguageCode }> {
  const credentials = googleSpeechCredentials();
  if (!credentials) throw new Error("Google Speech 서비스 계정이 등록되지 않았습니다");

  const phrases = (input.keywords ?? [])
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 100)
    .map((value) => ({ value }));
  const [response] = await clientFor(credentials).recognize({
    recognizer: `projects/${credentials.project_id}/locations/${LOCATION}/recognizers/_`,
    config: {
      explicitDecodingConfig: {
        encoding: "LINEAR16",
        sampleRateHertz: 24_000,
        audioChannelCount: 1,
      },
      model: "chirp_2",
      languageCodes: [googleSpeechLocale(input.lang)],
      features: { enableAutomaticPunctuation: true },
      adaptation: phrases.length
        ? { phraseSets: [{ inlinePhraseSet: { phrases } }] }
        : undefined,
    },
    content: input.pcm,
  });

  return {
    body: (response.results ?? [])
      .map((result) => result.alternatives?.[0]?.transcript?.trim() ?? "")
      .filter(Boolean)
      .join(" "),
    lang: input.lang,
  };
}
