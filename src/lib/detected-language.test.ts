import assert from "node:assert/strict";
import test from "node:test";

import { matchDetectedLanguage } from "./detected-language";

test("감지 언어를 등록된 입력 언어로만 정규화한다", () => {
  assert.equal(matchDetectedLanguage("KO", ["ko", "vi"]), "ko");
  assert.equal(matchDetectedLanguage("zh", ["ko", "zh-CN"]), "zh-CN");
  assert.equal(matchDetectedLanguage("zh", ["zh-CN", "zh-TW"]), null);
  assert.equal(matchDetectedLanguage("fr", ["ko", "vi"]), null);
  assert.equal(matchDetectedLanguage(undefined, ["ko"]), null);
});
