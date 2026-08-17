import assert from "node:assert/strict";
import test from "node:test";

import { AudioTurnDetector } from "./audio-turn-detector";

test("조용한 음성 뒤 무음을 감지하고 지속 잡음도 20초 안에 끊는다", () => {
  const quietVoice = new AudioTurnDetector();
  let now = 0;
  for (; now < 1_000; now += 20) assert.equal(quietVoice.update(0.0008, now), false);
  for (; now < 2_000; now += 20) assert.equal(quietVoice.update(0.005, now), false);
  let committed = false;
  for (; now < 3_000; now += 20) committed ||= quietVoice.update(0.0008, now);
  assert.equal(committed, true);

  const constantNoise = new AudioTurnDetector();
  committed = false;
  for (now = 0; now <= 20_100; now += 20) committed ||= constantNoise.update(0.02, now);
  assert.equal(committed, true);
});
