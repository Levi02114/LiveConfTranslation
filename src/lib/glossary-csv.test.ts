import assert from "node:assert/strict";
import test from "node:test";

import { parseGlossaryCsv, serializeGlossaryCsv } from "./glossary-csv";

test("단어집 CSV를 언어 순서와 쉼표·따옴표 손실 없이 왕복한다", () => {
  const csv = serializeGlossaryCsv(["vi", "ko"], [
    { ko: "안녕하세요", vi: 'Xin chào, "bạn"' },
  ]);

  assert.deepEqual(parseGlossaryCsv(`\uFEFF${csv}`, ["ko", "vi"]), [
    { vi: 'Xin chào, "bạn"', ko: "안녕하세요" },
  ]);
  assert.throws(() => parseGlossaryCsv("ko\n안녕하세요", ["ko", "vi"]));
  assert.throws(() => parseGlossaryCsv('ko,vi\n"닫히지 않음,Xin chào', ["ko", "vi"]));
});
