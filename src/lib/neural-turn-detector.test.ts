import assert from "node:assert/strict";
import { test } from "node:test";

import { gateVadFrame, MAX_TURN_MS, redemptionMsFor, SpeechTurnCommitter } from "@/lib/neural-turn-detector";
import { noiseGateRms } from "@/lib/voice-level";
import { SOFT_PAUSE_MS } from "@/lib/audio-turn-detector";

test("neural noise gate zeros classifier frames without modifying original audio or loud speech", () => {
  const quiet = new Float32Array(512).fill(0.003);
  const speech = new Float32Array(512).fill(0.03);
  const original = quiet.slice();
  const threshold = noiseGateRms(25);
  assert.deepEqual(gateVadFrame(quiet, threshold), new Float32Array(512));
  assert.deepEqual(quiet, original, "raw transcription audio stays intact");
  assert.equal(gateVadFrame(speech, threshold), speech);
  assert.equal(gateVadFrame(quiet, 0), quiet, "off keeps quiet voices and existing neural behavior");
  assert.equal(gateVadFrame(quiet, noiseGateRms(1)), quiet, "lower thresholds can recover quiet speakers");
});

test("일반 언어는 기본 redemption 을 쓴다", () => {
  assert.equal(redemptionMsFor(["ko"]), 1_100);
  assert.equal(redemptionMsFor(["vi"]), 1_100);
  assert.equal(redemptionMsFor([]), 1_100);
  assert.equal(redemptionMsFor(["en"]), 1_100);
});

test("천천히 말하는 언어는 긴 redemption 을 쓴다", () => {
  assert.equal(redemptionMsFor(["th"]), 1_700);
  assert.equal(redemptionMsFor(["si"]), 1_700);
});

test("후보 중 하나라도 해당하면 긴 쪽을 고른다", () => {
  assert.equal(redemptionMsFor(["ko", "si", "vi"]), 1_700);
  assert.equal(redemptionMsFor(["ko", "vi"]), 1_100);
});

test("지역 태그가 붙어도 기본 언어 코드로 판별한다", () => {
  assert.equal(redemptionMsFor(["th-TH"]), 1_700);
  assert.equal(redemptionMsFor(["ko-KR"]), 1_100);
});

test("40초 연속 발화는 15초마다 자르고 종료 구간도 커밋한다", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let commits = 0;
  const detector = new SpeechTurnCommitter(() => { commits += 1; });
  detector.handleSpeechStart();
  context.mock.timers.tick(MAX_TURN_MS);
  detector.handleSpeechFrame(0.9);
  context.mock.timers.tick(MAX_TURN_MS);
  detector.handleSpeechFrame(0.9);
  context.mock.timers.tick(10_000);
  detector.handleSpeechEnd();
  assert.equal(commits, 3);
});

test("최대 길이 커밋 직후 무음으로 끝나면 빈 턴을 다시 커밋하지 않는다", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let commits = 0;
  const detector = new SpeechTurnCommitter(() => { commits += 1; });
  detector.handleSpeechStart();
  context.mock.timers.tick(MAX_TURN_MS);
  detector.handleSpeechFrame(0.1);
  detector.handleSpeechEnd();
  assert.equal(commits, 1);
});

test("destroyed VAD ignores queued model callbacks and cannot rearm its timer", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let commits = 0;
  const detector = new SpeechTurnCommitter(() => { commits++; });
  detector.handleSpeechStart(); detector.destroy();
  detector.handleSpeechStart(); detector.handleSpeechFrame(0.9); detector.handleSpeechEnd();
  context.mock.timers.tick(MAX_TURN_MS * 2);
  assert.equal(commits, 0);
  assert.equal(detector.hasSpeech(), false);
});

test("neural maximum duration changes only at the next segment, including continuous speech", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let maxTurnMs = 30000;
  let commits = 0;
  const detector = new SpeechTurnCommitter(() => { commits++; }, () => maxTurnMs);
  detector.handleSpeechStart();
  maxTurnMs = 5000;
  context.mock.timers.tick(29999);
  assert.equal(commits, 0, "changing settings does not cut the current segment");
  context.mock.timers.tick(1);
  assert.equal(commits, 1);
  detector.handleSpeechFrame(0.9);
  context.mock.timers.tick(4999);
  assert.equal(commits, 1);
  context.mock.timers.tick(1);
  assert.equal(commits, 2);
  detector.handleSpeechEnd();
  assert.equal(commits, 2, "no empty commit after the maximum");
  maxTurnMs = 30000;
  detector.handleSpeechStart();
  context.mock.timers.tick(1000);
  detector.handleSpeechEnd();
  assert.equal(commits, 3, "silence can finish earlier");
  context.mock.timers.tick(30000);
  assert.equal(commits, 3, "speech end clears the old timer");
  detector.handleSpeechStart();
  detector.destroy();
  context.mock.timers.tick(30000);
  assert.equal(commits, 3, "stop cancels the configurable timer");
});

test("long continuous speech is cut at a short breath pause after half the maximum, not mid-word", (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let now = 0;
  let commits = 0;
  const detector = new SpeechTurnCommitter(() => { commits++; }, () => 15000, () => now);
  detector.handleSpeechStart();
  const frames = (ms: number, probability: number) => { for (let t = 0; t < ms; t += 32) { now += 32; detector.handleSpeechFrame(probability); } };
  frames(3000, 0.9); frames(400, 0.1);
  assert.equal(commits, 0, "a pause before half the maximum does not cut");
  frames(4500, 0.9); frames(200, 0.2); frames(300, 0.9);
  assert.equal(commits, 0, "a pause shorter than the soft pause does not cut");
  frames(SOFT_PAUSE_MS + 32, 0.1);
  assert.equal(commits, 1, "the first breath pause after half the maximum cuts");
  frames(600, 0.1);
  assert.equal(commits, 1, "silence alone does not commit an empty turn");
  frames(2000, 0.9);
  context.mock.timers.tick(15000);
  assert.equal(commits, 2, "speech without any pause still ends at the maximum");
});
