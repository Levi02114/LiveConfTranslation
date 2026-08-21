import assert from "node:assert/strict";
import test from "node:test";

import { LANGUAGE_CATALOG } from "@/lib/language-catalog";

import { localEngine, localTranslationRequest } from "./local";

test("llama.cpp 변환을 거치지 않고 TranslateGemma 프롬프트를 직접 보낸다", () => {
  const request = localTranslationRequest({ text: "안녕하세요", from: "ko", to: "en" });

  assert.match(request.prompt, /Korean \(ko\) to English \(en\) translator/);
  assert.match(request.prompt, /안녕하세요<end_of_turn>\n<start_of_turn>model\n$/);
});

test("등록 가능한 언어를 불완전한 수동 목록으로 차단하지 않는다", () => {
  assert.equal(LANGUAGE_CATALOG.every((lang) => localEngine.supports(lang)), true);
  assert.equal(localEngine.supports("si"), true);
  assert.equal(localEngine.supports("zh-TW"), true);
  assert.equal(localEngine.supports("fil"), true);
});

test("지역·문자 변형을 번역 프롬프트에 보존한다", () => {
  assert.match(
    localTranslationRequest({ text: "Olá", from: "pt-BR", to: "zh-TW" }).prompt,
    /\(pt-BR\) to .+ \(zh-TW\)/,
  );
  assert.match(
    localTranslationRequest({ text: "test", from: "en", to: "mni-Mtei" }).prompt,
    /\(mni-Mtei\)/,
  );
});
