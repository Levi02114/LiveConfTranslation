import assert from "node:assert/strict";
import test from "node:test";

import { parseRealtimeSession, parseVoiceEvent } from "./client-json";

test("공개 클라이언트 JSON 경계에서 필드 형식을 검증한다", () => {
  assert.deepEqual(parseRealtimeSession('{"leaseId":"lease","clientSecret":"secret","realtimeUrl":"https://example.test"}'), {
    leaseId: "lease",
    clientSecret: "secret",
    realtimeUrl: "https://example.test",
  });
  assert.equal(parseVoiceEvent('{"t":"transcript","itemId":3}'), null);
});
