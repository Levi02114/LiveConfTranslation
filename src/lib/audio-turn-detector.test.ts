import assert from "node:assert/strict";
import test from "node:test";

import { AudioTurnDetector } from "./audio-turn-detector";

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
