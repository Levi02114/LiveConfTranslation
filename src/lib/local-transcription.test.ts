import assert from "node:assert/strict";
import test from "node:test";

import { pcm24kToWav16k } from "@/lib/local-transcription";

test("24kHz PCM을 올바른 16kHz mono WAV로 만든다", () => {
  const pcm = Buffer.alloc(48_000); // 1초, PCM16 mono 24kHz
  const wav = pcm24kToWav16k(pcm);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.readUInt32LE(24), 16_000);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.length, 44 + 32_000);
});
