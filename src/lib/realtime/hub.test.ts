import assert from "node:assert/strict";
import test from "node:test";

import {
  claimInputName,
  disconnectAdminConnections,
  disconnectDisabledPages,
  join,
  leave,
  listInputParticipants,
  publish,
  stopInputVoice,
  type Connection,
} from "./hub";
import type { ServerMessage } from "./protocol";

test("입력 페이지가 다른 언어 원문과 번역도 받는다", () => {
  const received: ServerMessage[] = [];
  const serialized: string[] = [];
  const connection: Connection = {
    clientId: "test-input",
    meetingId: "test-meeting",
    kind: "input",
    lang: "vi",
    name: "test",
    nameClaimed: true,
    draft: "",
    send: (message, payload) => {
      received.push(message);
      if (payload) serialized.push(payload);
    },
  };

  join(connection);
  try {
    publish(connection.meetingId, {
      t: "message",
      messageId: 1,
      pageId: "ko-input",
      lang: "ko",
      body: "안녕하세요",
      speakerName: null,
      revision: 0,
      editedAt: null,
      createdAt: 1,
    });
    publish(connection.meetingId, {
      t: "translation",
      messageId: 1,
      sourceLang: "ko",
      lang: "si",
      body: "ආයුබෝවන්",
      speakerName: null,
      engine: "openai",
      status: "ok",
      revision: 0,
      editedAt: null,
      sourceCreatedAt: 1,
      createdAt: 2,
    });

    assert.deepEqual(
      received.map((message) => message.t),
      ["message", "translation"],
    );
    assert.deepEqual(serialized.map((payload) => JSON.parse(payload).t), ["message", "translation"]);
  } finally {
    leave(connection);
  }
});

test("설정에서 끈 출력 페이지의 기존 연결을 끊는다", () => {
  let closed = false;
  const connection: Connection = {
    clientId: "test-output",
    meetingId: "test-meeting-disabled",
    kind: "output",
    lang: "vi",
    name: "",
    nameClaimed: false,
    draft: "",
    send: () => undefined,
    close: () => { closed = true; },
  };
  join(connection);
  try {
    disconnectDisabledPages(connection.meetingId, [
      { lang: "ko", inputEnabled: true, outputEnabled: false },
      { lang: "vi", inputEnabled: true, outputEnabled: false },
    ]);
    assert.equal(closed, true);
  } finally {
    leave(connection);
  }
});

test("비밀번호 변경은 관리자 대시보드 연결만 끊는다", () => {
  let dashboardClosed = false;
  let inputClosed = false;
  const dashboard: Connection = {
    clientId: "admin-dashboard",
    meetingId: "password-change-meeting",
    kind: "dashboard",
    lang: null,
    name: "",
    nameClaimed: false,
    draft: "",
    send: () => undefined,
    close: () => { dashboardClosed = true; },
  };
  const input: Connection = {
    ...dashboard,
    clientId: "participant-input",
    kind: "input",
    lang: "ko",
    close: () => { inputClosed = true; },
  };

  join(dashboard);
  join(input);
  try {
    disconnectAdminConnections();
    assert.equal(dashboardClosed, true);
    assert.equal(inputClosed, false);
  } finally {
    leave(dashboard);
    leave(input);
  }
});

test("같은 세션에서는 언어가 달라도 닉네임을 중복 등록할 수 없다", () => {
  const first: Connection = {
    clientId: "first",
    meetingId: "nickname-meeting",
    kind: "input",
    lang: "ko",
    name: "#1",
    nameClaimed: false,
    draft: "",
    send: () => undefined,
  };
  const second: Connection = {
    ...first,
    clientId: "second",
    lang: "vi",
    name: "#2",
  };

  join(first);
  join(second);
  try {
    assert.equal(claimInputName(first, "Levi"), true);
    assert.equal(claimInputName(second, "ｌｅｖｉ"), false);
    leave(first);
    assert.equal(claimInputName(second, "Levi"), true);
  } finally {
    leave(first);
    leave(second);
  }
});

test("통합 입력도 전체 원문·번역을 받고 일반 입력과 닉네임을 공유한다", () => {
  const received: ServerMessage[] = [];
  const combined: Connection = {
    clientId: "combined",
    meetingId: "combined-input-meeting",
    kind: "combined-input",
    lang: "ko",
    name: "#1",
    nameClaimed: false,
    draft: "",
    send: (message) => received.push(message),
  };
  const regular: Connection = {
    ...combined,
    clientId: "regular",
    kind: "input",
    lang: "vi",
    send: () => undefined,
  };

  join(combined);
  join(regular);
  try {
    assert.equal(claimInputName(regular, "Levi"), true);
    assert.equal(claimInputName(combined, "levi"), false);
    publish(combined.meetingId, {
      t: "message",
      messageId: 9,
      pageId: "vi-input",
      lang: "vi",
      body: "Xin chào",
      speakerName: "Levi",
      revision: 0,
      editedAt: null,
      createdAt: 1,
    });
    assert.equal(received.at(-1)?.t, "message");
  } finally {
    leave(combined);
    leave(regular);
  }
});

test("관리자는 모든 입력 참가자를 조회하고 한 명의 마이크만 중지한다", () => {
  const firstMessages: ServerMessage[] = [];
  const secondMessages: ServerMessage[] = [];
  const first: Connection = {
    clientId: "voice-first",
    meetingId: "voice-control-meeting",
    kind: "input",
    lang: "ko",
    name: "Levi",
    nameClaimed: true,
    ip: "192.168.0.10",
    draft: "",
    send: (message) => firstMessages.push(message),
  };
  const second: Connection = {
    ...first,
    clientId: "voice-second",
    lang: "vi",
    name: "Minh",
    nameClaimed: false,
    ip: "192.168.0.11",
    send: (message) => secondMessages.push(message),
  };

  join(first);
  join(second);
  try {
    assert.deepEqual(listInputParticipants(first.meetingId), [
      {
        participantId: "voice-first",
        speakerName: "Levi",
        lang: "ko",
        ip: "192.168.0.10",
      },
      {
        participantId: "voice-second",
        speakerName: null,
        lang: "vi",
        ip: "192.168.0.11",
      },
    ]);
    assert.equal(stopInputVoice(first.meetingId, "voice-first"), true);
    assert.deepEqual(firstMessages, [{ t: "voice-stop" }]);
    assert.deepEqual(secondMessages, []);
  } finally {
    leave(first);
    leave(second);
  }
});
