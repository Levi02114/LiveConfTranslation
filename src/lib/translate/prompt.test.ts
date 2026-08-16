import assert from "node:assert/strict";
import test from "node:test";

import { targetLanguageRules } from "./prompt";

test("등록 언어 코드에서 언어별 표기 지시문을 자동 생성한다", () => {
  assert.match(targetLanguageRules("vi")[0], /Vietnamese.*Latin \(Latn\)/);
  assert.match(targetLanguageRules("th")[0], /Thai.*Thai \(Thai\)/);
  assert.match(targetLanguageRules("si")[0], /Sinhala.*Sinhala \(Sinh\)/);
  assert.match(targetLanguageRules("ja")[0], /Japanese.*Japanese \(Jpan\)/);
  assert.equal(targetLanguageRules("ko").length, 1);
  assert.match(targetLanguageRules("ja")[1], /zero Hangul/);
});
