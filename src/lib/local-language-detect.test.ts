import assert from "node:assert/strict";
import test from "node:test";

import { detectLocalTextLanguage, selectLocalPrediction } from "@/lib/local-language-detect";

test("로컬 언어 감지는 세션 후보와 신뢰도 임계값을 모두 지킨다", () => {
  assert.deepEqual(
    selectLocalPrediction(new Map([["__label__vi", 0.91]]), ["ko", "vi"]),
    { lang: "vi", confidence: 0.91 },
  );
  assert.deepEqual(
    selectLocalPrediction(new Map([["__label__en", 0.8], ["__label__vi", 0.42]]), ["ko", "vi"]),
    { lang: null, confidence: 0.42 },
  );
});

test("내장 fastText 모델이 실제 문장을 세션 후보 안에서 감지한다", async () => {
  const detected = await detectLocalTextLanguage("Xin chào, hôm nay bạn khỏe không?", ["ko", "vi"]);
  assert.equal(detected.lang, "vi");
  assert.ok(detected.confidence > 0.9);
});
