import assert from "node:assert/strict";
import { test } from "node:test";

import { mergeCombinedEntries } from "./combined-entry";
import type { CombinedEntry } from "./repo";

const entry = (messageId: number, patch: Partial<CombinedEntry> = {}): CombinedEntry => ({
  messageId, sourceLang: "ko", sourceBody: `원문 ${messageId}`, speakerName: null, pageId: null,
  revision: 0, editedAt: null, createdAt: messageId, updatedAt: messageId, translations: [], ...patch,
});

test("reconnect resync fills missed sources and translations in message order", () => {
  const current = [entry(1), entry(3)];
  const merged = mergeCombinedEntries(current, [
    entry(2, { translations: [{ lang: "vi", body: "bản dịch 2", status: "ok", error: null }] }),
    entry(3, { translations: [{ lang: "vi", body: "bản dịch 3", status: "ok", error: null }] }),
  ]);
  assert.deepEqual(merged.map((row) => row.messageId), [1, 2, 3]);
  assert.equal(merged[1]!.translations[0]!.body, "bản dịch 2");
  assert.equal(merged[2]!.translations[0]!.body, "bản dịch 3");
  assert.equal(mergeCombinedEntries(merged, []), merged);
});

test("resync never rolls an edited message back to an older revision", () => {
  const current = [entry(1, { revision: 2, sourceBody: "수정본" })];
  const merged = mergeCombinedEntries(current, [entry(1, { revision: 1, sourceBody: "이전본" })]);
  assert.equal(merged[0]!.sourceBody, "수정본");
});
