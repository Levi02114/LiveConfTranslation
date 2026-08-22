import { z } from "zod";

import { matchDetectedLanguage } from "@/lib/detected-language";
import type { LanguageCode } from "@/lib/languages";
import { ensureLocalTranscriptionRuntime } from "@/lib/local-runtime";
import { scriptLanguageOf } from "@/lib/script-language";

const responseSchema = z.object({
  text: z.string(),
  language_probabilities: z.record(z.string(), z.number()).optional(),
});

/** 브라우저가 보내는 mono PCM16 24kHz를 whisper.cpp용 WAV 16kHz로 바꾼다. */
export function pcm24kToWav16k(pcm: Buffer): Buffer {
  const source = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
  const count = Math.floor(source.length * (16_000 / 24_000));
  const wav = Buffer.allocUnsafe(44 + count * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + count * 2, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(16_000, 24);
  wav.writeUInt32LE(32_000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(count * 2, 40);
  for (let index = 0; index < count; index += 1) {
    const position = index * 1.5;
    const left = Math.floor(position);
    const fraction = position - left;
    const sample = Math.round(source[left] * (1 - fraction) + (source[left + 1] ?? source[left]) * fraction);
    wav.writeInt16LE(sample, 44 + index * 2);
  }
  return wav;
}

export async function transcribeLocalPcm(input: {
  pcm: Buffer;
  languages: readonly LanguageCode[];
  prompt: string;
}): Promise<{ body: string; lang: LanguageCode | null; confidence: number }> {
  const origin = await ensureLocalTranscriptionRuntime();
  const form = new FormData();
  const wav = pcm24kToWav16k(input.pcm);
  form.set("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "turn.wav");
  form.set("temperature", "0.0");
  form.set("temperature_inc", "0.2");
  form.set("response_format", input.languages.length === 1 ? "json" : "verbose_json");
  form.set("prompt", input.prompt);
  form.set("carry_initial_prompt", "true");
  form.set("language", input.languages.length === 1 ? input.languages[0].split("-")[0] : "auto");

  const response = await fetch(`${origin}/inference`, { method: "POST", body: form });
  if (!response.ok) throw new Error(`whisper.cpp ${response.status}`);
  const parsed = responseSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new Error("whisper.cpp 응답이 올바르지 않습니다");
  const body = parsed.data.text.trim();
  const scripted = scriptLanguageOf(body, input.languages);
  const detected = Object.entries(parsed.data.language_probabilities ?? {})
    .sort((a, b) => b[1] - a[1])
    .map(([code, confidence]) => ({ lang: matchDetectedLanguage(code, input.languages), confidence }))
    .find((row) => row.lang) ?? { lang: null, confidence: 0 };
  if (scripted) return { body, lang: scripted, confidence: 1 };
  if (input.languages.length === 1) return { body, lang: input.languages[0], confidence: 1 };
  return {
    body,
    lang: detected.confidence >= 0.55 ? detected.lang : null,
    confidence: detected.confidence,
  };
}
