import assert from "node:assert/strict";
import test from "node:test";

import { hasHangulLeak } from "./quality";

test("한국어 번역 결과의 한글 누출만 찾는다", () => {
  assert.equal(hasHangulLeak("හරිම රස්නෙයි네요", "si"), true);
  assert.equal(hasHangulLeak("가나다라", "si"), true);
  assert.equal(hasHangulLeak("Nóng quá nhỉ", "vi"), false);
  assert.equal(hasHangulLeak("한국어", "ko"), false);
});
