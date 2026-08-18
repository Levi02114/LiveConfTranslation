import assert from "node:assert/strict";
import test from "node:test";

import { getLanguage } from "./languages";

test("Electron에 싱할라어 ICU가 없어도 검수된 원어명을 표시한다", () => {
  const original = Intl.DisplayNames;
  Object.defineProperty(Intl, "DisplayNames", {
    configurable: true,
    value: class {
      of() {
        return "Sinhala";
      }
    },
  });

  try {
    assert.equal(getLanguage("si").nativeName, "සිංහල");
  } finally {
    Object.defineProperty(Intl, "DisplayNames", { configurable: true, value: original });
  }
});
