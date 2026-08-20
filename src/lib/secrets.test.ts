import assert from "node:assert/strict";
import test from "node:test";

import { OPENAI_TRANSLATION_MODEL, resolveOpenaiModel } from "@/lib/secrets";

test("OpenAI 번역 모델은 gpt-5.6-luna로 고정한다", () => {
  assert.equal(OPENAI_TRANSLATION_MODEL, "gpt-5.6-luna");
  assert.equal(resolveOpenaiModel(), OPENAI_TRANSLATION_MODEL);
});
