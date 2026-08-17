import assert from "node:assert/strict";
import test from "node:test";

import {
  builtinStyleCue,
  STYLE_CUE_SOURCE,
  targetLanguageRules,
} from "./prompt";

test("등록 언어 코드에서 언어별 표기 지시문을 자동 생성한다", () => {
  assert.match(targetLanguageRules("vi")[0], /Vietnamese.*Latin \(Latn\)/);
  assert.match(targetLanguageRules("th")[0], /Thai.*Thai \(Thai\)/);
  assert.match(targetLanguageRules("si")[0], /Sinhala.*Sinhala \(Sinh\)/);
  assert.match(targetLanguageRules("ja")[0], /Japanese.*Japanese \(Jpan\)/);
  assert.equal(targetLanguageRules("ko").length, 1);
  assert.match(targetLanguageRules("ja")[1], /zero Hangul/);
});

test("회의 번역에만 대상 언어 문체 지시문을 조합한다", () => {
  const vietnameseCue = builtinStyleCue("vi");
  assert.ok(vietnameseCue);
  assert.match(vietnameseCue, /tiếng Việt/);
  assert.equal(builtinStyleCue("en"), STYLE_CUE_SOURCE);
  assert.equal(targetLanguageRules("vi").includes(vietnameseCue), false);
  assert.equal(targetLanguageRules("vi", vietnameseCue).at(-1), vietnameseCue);
});
