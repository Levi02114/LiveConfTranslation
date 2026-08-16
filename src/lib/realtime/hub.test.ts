import assert from "node:assert/strict";
import test from "node:test";

import { join, leave, publish, type Connection } from "./hub";
import type { ServerMessage } from "./protocol";

test("입력 페이지가 다른 언어 원문과 번역도 받는다", () => {
  const received: ServerMessage[] = [];
  const connection: Connection = {
    clientId: "test-input",
    meetingId: "test-meeting",
    kind: "input",
    lang: "vi",
    name: "test",
    draft: "",
    send: (message) => received.push(message),
  };

  join(connection);
  try {
    publish(connection.meetingId, {
      t: "message",
      messageId: 1,
      lang: "ko",
      body: "안녕하세요",
      createdAt: 1,
    });
    publish(connection.meetingId, {
      t: "translation",
      messageId: 1,
      sourceLang: "ko",
      lang: "si",
      body: "ආයුබෝවන්",
      engine: "openai",
      status: "ok",
      createdAt: 2,
    });

    assert.deepEqual(
      received.map((message) => message.t),
      ["message", "translation"],
    );
  } finally {
    leave(connection);
  }
});
