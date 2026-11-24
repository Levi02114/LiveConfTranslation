import assert from "node:assert/strict";
import test from "node:test";

import { AudioTurnDetector, SOFT_PAUSE_MS } from "./audio-turn-detector";
import { noiseGateRms } from "./voice-level";

test("짧은 말 사이 쉼은 유지하고 1.1초 무음에서 자동 확정한다", () => {
  for (const [noise, voice] of [[0.0008, 0.004], [0.004, 0.008]]) {
    const detector = new AudioTurnDetector();
    let now = 0;
    for (; now < 1_000; now += 20) assert.equal(detector.update(noise, now), false);
    for (; now < 2_000; now += 20) assert.equal(detector.update(voice, now), false);
    let committed = false;
    for (; now < 3_000; now += 20) committed ||= detector.update(noise, now);
    assert.equal(committed, false);
    for (; now < 3_200; now += 20) committed ||= detector.update(noise, now);
    assert.equal(committed, true);
  }
});

test("noise gate ends noise-held turns, ignores noise-only input and can be lowered for quiet speakers", () => {
  let gate = 0;
  const detector = new AudioTurnDetector(() => 1100, () => 15000, () => noiseGateRms(gate));
  for (let i = 0; i < 100; i++) detector.calibrate(0.0008);
  for (let now = 0; now < 2000; now += 20) assert.equal(detector.update(now < 1000 ? 0.03 : 0.003, now), false);
  assert.equal(detector.phase(), "speech", "background noise holds the old detector open");
  gate = 25;
  assert.equal(detector.update(0.003, 2000), false);
  assert.equal(detector.phase(), "silence", "live setting starts the silence countdown");
  assert.equal(detector.update(0.003, 3099), false);
  assert.equal(detector.update(0.003, 3100), true);
  for (let now = 3120; now < 6000; now += 20) assert.equal(detector.update(0.003, now), false);
  assert.equal(detector.hasSpeech(), false, "noise alone cannot start a turn");
  assert.equal(detector.update(0.02, 6000), false);
  assert.equal(detector.hasSpeech(), true, "clear speech remains detectable");
  detector.update(0, 6200);
  assert.equal(detector.update(0, 7300), true);
  gate = 0;
  for (let i = 0; i < 100; i++) detector.calibrate(0.0008);
  detector.update(0.003, 7400);
  assert.equal(detector.hasSpeech(), true, "turning the gate off restores quiet voice sensitivity");
});

test("휴대폰의 변동 배경 잡음을 먼저 학습하고 발화 뒤 자동 확정한다", () => {
  const detector = new AudioTurnDetector();
  const mobileNoise = [0.003, 0.0045, 0.0038, 0.005, 0.0035];
  for (let index = 0; index < 40; index += 1) {
    detector.calibrate(mobileNoise[index % mobileNoise.length]);
  }

  let now = 0;
  for (; now < 1_500; now += 20) assert.equal(detector.update(0.012, now), false);
  let committed = false;
  for (; now < 2_800; now += 20) {
    committed ||= detector.update(mobileNoise[(now / 20) % mobileNoise.length], now);
  }
  assert.equal(committed, true);
});

test("RMS maximum duration changes at the next segment and silence can still finish earlier", () => {
  let maxTurnMs = 30000;
  const detector = new AudioTurnDetector(() => 1100, () => maxTurnMs);
  for (let i = 0; i < 40; i++) detector.calibrate(0.0005);
  assert.equal(detector.update(0.02, 0), false);
  maxTurnMs = 5000;
  assert.equal(detector.update(0.02, 15000), false, "current segment keeps its 30-second cap");
  assert.equal(detector.update(0.02, 29999), false);
  assert.equal(detector.update(0.02, 30000), true);
  assert.equal(detector.update(0.02, 30020), false);
  assert.equal(detector.update(0.02, 35019), false);
  assert.equal(detector.update(0.02, 35020), true, "continuous speech uses the new cap");
  maxTurnMs = 30000;
  detector.update(0.02, 36000);
  detector.update(0, 36100);
  assert.equal(detector.update(0, 37200), true, "silence ends before the maximum");
});

test("RMS fallback also cuts long continuous speech at a short pause after half the maximum", () => {
  const detector = new AudioTurnDetector(() => 1100, () => 15000);
  for (let i = 0; i < 100; i++) detector.calibrate(0.0008);
  let now = 0;
  const run = (ms: number, rms: number) => { let cut = false; for (const end = now + ms; now < end; now += 20) cut ||= detector.update(rms, now); return cut; };
  assert.equal(run(3000, 0.02), false);
  assert.equal(run(500, 0.0008), false, "an early pause keeps the turn");
  assert.equal(run(4500, 0.02), false);
  assert.equal(run(200, 0.0008), false, "a very short gap keeps the turn");
  assert.equal(run(300, 0.02), false);
  assert.equal(run(SOFT_PAUSE_MS + 20, 0.0008), true, "the first breath pause after 7.5s cuts");
});
