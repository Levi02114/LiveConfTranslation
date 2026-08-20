/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");

const { recommendedModels, stringsFor } = require("./local-ai.cjs");

test("시스템 메모리에 맞춰 보수적인 로컬 모델을 추천한다", () => {
  assert.deepEqual(recommendedModels(8 * 1024 ** 3), { translation: "4b", transcription: "small" });
  assert.deepEqual(recommendedModels(24 * 1024 ** 3), { translation: "12b", transcription: "medium" });
  assert.deepEqual(recommendedModels(48 * 1024 ** 3), { translation: "27b", transcription: "medium" });
});

test("로컬 AI 설치 문구는 기본 4개 언어에서 같은 키를 제공한다", () => {
  const keys = Object.keys(stringsFor({ getLocale: () => "ko" })).sort();
  for (const locale of ["vi", "th", "si"]) {
    assert.deepEqual(Object.keys(stringsFor({ getLocale: () => locale })).sort(), keys);
  }
});
