import assert from "node:assert/strict";
import { test } from "node:test";

import { meterLevel, VoiceMeterTracker } from "@/lib/voice-level";

test("음량 매핑은 -60dB 이하를 0, 0dB 를 1 로 눌러 담는다", () => {
  assert.equal(meterLevel(0), 0);
  assert.equal(meterLevel(0.000001), 0);
  assert.equal(meterLevel(1), 1);
  assert.equal(meterLevel(2), 1);
  // -30dB 부근의 보통 말소리는 중간쯤에 놓인다.
  const mid = meterLevel(0.03);
  assert.ok(mid > 0.4 && mid < 0.6, `mid=${mid}`);
});

test("짧게 작아진 것은 안내를 띄우지 않고, 계속 작으면 띄운다", () => {
  const tracker = new VoiceMeterTracker();
  assert.equal(tracker.update(0.001, 0.1, 0).tooQuiet, false);
  assert.equal(tracker.update(0.001, 0.1, 1_000).tooQuiet, false);
  assert.equal(tracker.update(0.001, 0.1, 2_600).tooQuiet, true);
  // 소리가 커지면 바로 거둬들인다.
  assert.equal(tracker.update(0.05, 0.1, 2_700).tooQuiet, false);
  assert.equal(tracker.update(0.001, 0.1, 2_800).tooQuiet, false);
});

test("클리핑은 피크 순간에 뜨고 잠시 유지된다", () => {
  const tracker = new VoiceMeterTracker();
  assert.equal(tracker.update(0.5, 0.99, 0).clipping, true);
  assert.equal(tracker.update(0.3, 0.5, 500).clipping, true);
  assert.equal(tracker.update(0.3, 0.5, 1_100).clipping, false);
});

test("비정상 입력은 0 으로 눌러 담는다", () => {
  const tracker = new VoiceMeterTracker();
  const meter = tracker.update(Number.NaN, Number.NaN, 0);
  assert.equal(meter.level, 0);
  assert.equal(meter.clipping, false);
});
