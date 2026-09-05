import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import test from "node:test";

const testDatabasePath = ".tmp/test-detect-text-language.db";
rmSync(testDatabasePath, { force: true });
process.env.DATABASE_PATH = testDatabasePath;

test("고유 문자 언어는 외부 감지 없이 즉시 선택한다", async () => {
  const { detectTextLanguage } = await import("./detect-text-language");
  assert.deepEqual(
    await detectTextLanguage("මෙන්න පරීක්ෂණයක්", ["ko", "si"], "ko"),
    { lang: "si", usedFallback: false, confidence: 1 },
  );
});
