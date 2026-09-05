import assert from "node:assert/strict";
import test from "node:test";

import { shouldSendRealtimeMessage } from "./use-realtime";

test("느린 연결에서는 중간 초안만 버리고 최종 지우기와 이름은 보낸다", () => {
  assert.equal(shouldSendRealtimeMessage({ t: "draft", text: "작성 중" }, 65 * 1024), false);
  assert.equal(shouldSendRealtimeMessage({ t: "draft", text: "" }, 65 * 1024), true);
  assert.equal(shouldSendRealtimeMessage({ t: "name", name: "속기사" }, 65 * 1024), true);
});
