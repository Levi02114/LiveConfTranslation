import assert from "node:assert/strict";
import test from "node:test";

import { localEngine, localTranslationRequest } from "./local";

test("llama.cpp 변환을 거치지 않고 TranslateGemma 프롬프트를 직접 보낸다", () => {
  const request = localTranslationRequest({ text: "안녕하세요", from: "ko", to: "en" });

  assert.match(request.prompt, /Korean \(ko\) to English \(en\) translator/);
  assert.match(request.prompt, /안녕하세요<end_of_turn>\n<start_of_turn>model\n$/);
});

test("TranslateGemma 공식 지원 언어인 싱할라어를 허용한다", () => {
  assert.equal(localEngine.supports("si"), true);
});
