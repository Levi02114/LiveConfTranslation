import assert from "node:assert/strict";
import test from "node:test";

import { FALLBACK_UI, translationFailureText } from "../i18n-builtin";
import { classifyOpenAiError } from "./openai";

test("OpenAI 429 결제 부족과 순간 요청 제한을 구분한다", () => {
  assert.equal(
    classifyOpenAiError(429, JSON.stringify({ error: { code: "credit_balance_exhausted" } })),
    "openai-billing-limit",
  );
  assert.equal(
    classifyOpenAiError(429, JSON.stringify({ error: { type: "insufficient_quota" } })),
    "openai-billing-limit",
  );
  assert.equal(classifyOpenAiError(429, "rate limited"), "openai-rate-limit");
  assert.equal(classifyOpenAiError(500, "server error"), undefined);
  assert.equal(
    translationFailureText(
      'OpenAI 가 429 를 반환했습니다: {"error":{"type":"insufficient_quota"}}',
      FALLBACK_UI.status,
    ),
    FALLBACK_UI.status.openaiBilling,
  );
});
