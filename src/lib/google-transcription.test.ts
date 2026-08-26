import assert from "node:assert/strict";
import test from "node:test";

import { googleSpeechLocale } from "@/lib/google-transcription";

test("Google Speech 지역 코드는 기본 언어와 명시적 로케일을 보존한다", () => {
  assert.equal(googleSpeechLocale("si"), "si-LK");
  assert.equal(googleSpeechLocale("ko"), "ko-KR");
  assert.equal(googleSpeechLocale("zh-CN"), "cmn-Hans-CN");
  assert.equal(googleSpeechLocale("en-GB"), "en-GB");
});
