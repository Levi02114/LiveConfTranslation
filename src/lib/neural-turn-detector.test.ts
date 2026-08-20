import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_TURN_MS, redemptionMsFor, SpeechTurnCommitter } from "@/lib/neural-turn-detector";

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
