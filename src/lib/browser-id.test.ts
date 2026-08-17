import assert from "node:assert/strict";
import test from "node:test";

import { newBrowserId } from "./browser-id";

test("보안 컨텍스트 전용 API 없이 브라우저 ID를 만든다", () => {
  assert.match(newBrowserId(), /^[0-9a-f]{32}$/);
  assert.notEqual(newBrowserId(), newBrowserId());
});
