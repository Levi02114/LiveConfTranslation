import assert from "node:assert/strict";
import test from "node:test";

import { appendTranscriptDraft } from "@/lib/transcript-draft";

test("전사 결과를 기존 초안 뒤에 덮어쓰기 없이 붙인다", () => {
  assert.equal(appendTranscriptDraft("기존 초안  ", " 새 전사 "), "기존 초안 새 전사");
  assert.equal(appendTranscriptDraft("", "첫 전사"), "첫 전사");
});
