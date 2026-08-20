/**
 * 통합 입력 2차 전사(second-pass rescue).
 *
 * gpt-transcribe 의 다언어 자동 감지는 싱할라어처럼 힌트 미지원 언어에서 무너진다 —
 * 실측에서 싱할라어 발화를 디베히 문자(Thaana)로 음역해 버리는 경우가 있었다
 * (CER 100%+). 실시간 세션은 언어를 고정할 수 없지만, 턴이 끝난 뒤 배치 API 는
 * 더 강한 모델로 그 구간만 다시 전사할 수 있다. 문자 증거·모델 감지가 모두 없는
 * 턴(usedFallback)에만 이 경로를 태운다.
 */
import { openaiBaseUrl } from "@/lib/env";
import { z } from "zod";

import { parseJsonResponse } from "@/lib/json-response";

const transcriptionResponseSchema = z.object({ text: z.string() });

/** 구조는 지연·비용을 올리므로 긴 턴에는 태우지 않는다. */
export const RESCUE_MAX_BYTES = 30 * 24_000 * 2; // 30초 × 24kHz × s16le
export const RESCUE_BUFFER_MAX_BYTES = 60 * 24_000 * 2; // 완료 지연을 포함해 최대 60초만 보관

type AudioSegment = { start: number; end: number };

/** 커밋 경계와 OpenAI item_id 를 결합해 완료 순서와 무관하게 같은 PCM 을 찾는다. */
export class RescueAudioTurns {
  private readonly chunks: Buffer[] = [];
  private readonly pending: AudioSegment[] = [];
  private readonly byItem = new Map<string, AudioSegment>();
  private baseOffset = 0;
  private totalOffset = 0;
  private retainedBytes = 0;
  private lastCommitOffset = 0;

  append(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.retainedBytes += chunk.byteLength;
    this.totalOffset += chunk.byteLength;
    while (this.retainedBytes > RESCUE_BUFFER_MAX_BYTES && this.chunks.length > 1) {
      const removed = this.chunks.shift();
      if (!removed) break;
      this.baseOffset += removed.byteLength;
      this.retainedBytes -= removed.byteLength;
    }
  }

  markCommit(): void {
    this.pending.push({ start: this.lastCommitOffset, end: this.totalOffset });
    this.lastCommitOffset = this.totalOffset;
  }

  bindCommit(itemId: string): void {
    const segment = this.pending.shift();
    if (segment) this.byItem.set(itemId, segment);
  }

  take(itemId: string): Buffer | null {
    const segment = this.byItem.get(itemId);
    this.byItem.delete(itemId);
    if (!segment) return null;

    const relativeStart = segment.start - this.baseOffset;
    const relativeEnd = segment.end - this.baseOffset;
    const pcm =
      relativeStart >= 0 && relativeEnd > relativeStart && relativeEnd <= this.retainedBytes
        ? Buffer.concat(this.chunks, this.retainedBytes).subarray(relativeStart, relativeEnd)
        : null;
    this.pruneThrough(segment.end);
    return pcm;
  }

  private pruneThrough(offset: number): void {
    while (this.chunks.length && this.baseOffset + this.chunks[0].byteLength <= offset) {
      const removed = this.chunks.shift();
      if (!removed) break;
      this.baseOffset += removed.byteLength;
      this.retainedBytes -= removed.byteLength;
    }
  }
}

/** 24kHz mono s16le PCM 에 WAV 헤더를 씌운다. */
export function pcm24ToWav(pcm: Buffer): Buffer {
  const rate = 24_000;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16); // fmt chunk 크기
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * 배치 전사로 턴을 다시 듣는다. 언어를 고정하지 않는다 — 잘못 고정하면 그 언어
 * 문자로 그럴듯한 환각이 나와 문자 검증이 무너진다. 실패·타임아웃이면 null.
 */
export async function rescueTranscribe(opts: {
  pcm: Buffer;
  key: string;
  prompt: string;
}): Promise<string | null> {
  try {
    const form = new FormData();
    form.set("model", "gpt-4o-transcribe");
    form.set("prompt", opts.prompt);
    form.set("file", new Blob([new Uint8Array(pcm24ToWav(opts.pcm))], { type: "audio/wav" }), "turn.wav");
    const response = await fetch(`${openaiBaseUrl()}/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${opts.key}` },
      body: form,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const payload = await parseJsonResponse(response, transcriptionResponseSchema);
    return payload?.text.trim() || null;
  } catch {
    return null;
  }
}
