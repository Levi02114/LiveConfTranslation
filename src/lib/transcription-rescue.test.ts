import assert from "node:assert/strict";
import { test } from "node:test";

import {
  pcm24ToWav,
  RescueAudioTurns,
  RESCUE_BUFFER_MAX_BYTES,
  RESCUE_MAX_BYTES,
  rescueTranscribe,
} from "@/lib/transcription-rescue";

test("WAV 헤더가 PCM 길이와 24kHz mono s16le 를 정확히 담는다", () => {
  const pcm = Buffer.alloc(4800, 1); // 100ms
  const wav = pcm24ToWav(pcm);
  assert.equal(wav.length, 44 + pcm.length);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(4), 36 + pcm.length);
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt16LE(20), 1); // PCM
  assert.equal(wav.readUInt16LE(22), 1); // mono
  assert.equal(wav.readUInt32LE(24), 24_000);
  assert.equal(wav.readUInt32LE(28), 48_000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.toString("ascii", 36, 40), "data");
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.ok(wav.subarray(44).equals(pcm));
});

test("구조 상한은 30초 분량이다", () => {
  assert.equal(RESCUE_MAX_BYTES, 30 * 24_000 * 2);
  assert.equal(RESCUE_BUFFER_MAX_BYTES, 60 * 24_000 * 2);
});

test("완료 이벤트 순서가 달라도 item_id 에 커밋 당시 PCM 을 연결한다", () => {
  const turns = new RescueAudioTurns();
  turns.append(Buffer.from("first"));
  turns.markCommit();
  turns.append(Buffer.from("second"));
  turns.markCommit();
  turns.bindCommit("item-a");
  turns.bindCommit("item-b");

  // B가 먼저 완료되어도 서버는 커밋 순서인 A를 먼저 꺼낸다.
  assert.equal(turns.take("item-a")?.toString(), "first");
  assert.equal(turns.take("item-b")?.toString(), "second");
});

test("60초 보관 한도를 벗어난 턴은 rescue 만 생략한다", () => {
  const turns = new RescueAudioTurns();
  turns.append(Buffer.alloc(RESCUE_BUFFER_MAX_BYTES, 1));
  turns.markCommit();
  turns.append(Buffer.from([2]));
  turns.bindCommit("old");
  assert.equal(turns.take("old"), null);
});

test("언어 고정 재전사는 ISO-639-1 language 를 보낸다", async () => {
  const originalFetch = globalThis.fetch;
  const mockFetch: typeof fetch = async (_input, init) => {
    assert.ok(init?.body instanceof FormData);
    assert.equal(init.body.get("language"), "si");
    return Response.json({ text: "ඔයාගේ නම මොකක්ද?" });
  };
  globalThis.fetch = mockFetch;
  try {
    assert.equal(
      await rescueTranscribe({ pcm: Buffer.alloc(9600), key: "test", prompt: "test", language: "si" }),
      "ඔයාගේ නම මොකක්ද?",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
