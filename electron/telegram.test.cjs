/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  notificationKey,
  pairingChat,
  retryDelay,
  shouldNotifyTunnelStopped,
  shouldReplaceTunnel,
  shouldSendTelegramUrl,
  stringsForLocale,
} = require("./telegram.cjs");

test("터널 재시도는 짧게 시작해 60초에서 멈춘다", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 9].map(retryDelay), [2_000, 5_000, 15_000, 30_000, 60_000, 60_000]);
});

test("로컬 서버가 정상이고 공개 상태가 세 번 실패했을 때만 터널을 교체한다", () => {
  assert.equal(shouldReplaceTunnel("ours", 2), false);
  assert.equal(shouldReplaceTunnel("ours", 3), true);
  assert.equal(shouldReplaceTunnel("occupied", 3), false);
});

test("안내한 활성 터널이 앱 종료 외의 이유로 끊겼을 때만 종료 알림을 보낸다", () => {
  assert.equal(shouldNotifyTunnelStopped(null, "https://one.example", "https://one.example"), true);
  assert.equal(shouldNotifyTunnelStopped("manual", "https://one.example", "https://one.example"), true);
  assert.equal(shouldNotifyTunnelStopped("quit", "https://one.example", "https://one.example"), false);
  assert.equal(shouldNotifyTunnelStopped("recovery", null, "https://one.example"), false);
  assert.equal(shouldNotifyTunnelStopped("recovery", "https://two.example", "https://one.example"), false);
});

test("연결된 봇은 자동 복구 설정과 무관하게 새 활성 URL을 알릴 수 있다", () => {
  assert.equal(shouldSendTelegramUrl(true, 1, "https://new.example", "https://new.example"), true);
  assert.equal(shouldSendTelegramUrl(false, 1, "https://new.example", "https://new.example"), false);
  assert.equal(shouldSendTelegramUrl(true, 0, "https://new.example", "https://new.example"), false);
  assert.equal(shouldSendTelegramUrl(true, 1, "https://old.example", "https://new.example"), false);
});

test("일회용 시작 명령과 요청한 채팅 종류가 모두 맞아야 등록한다", () => {
  const update = {
    message: {
      text: "/start exact-nonce",
      chat: { id: -123, type: "supergroup", title: "행사 운영" },
    },
  };
  assert.deepEqual(pairingChat(update, "exact-nonce", "group"), {
    id: "-123",
    title: "행사 운영",
    type: "supergroup",
  });
  assert.equal(pairingChat(update, "another-nonce", "group"), null);
  assert.equal(pairingChat(update, "exact-nonce", "private"), null);
});

test("알림 중복 키는 채팅과 URL을 함께 구분한다", () => {
  assert.notEqual(notificationKey("1", "https://one.example"), notificationKey("2", "https://one.example"));
  assert.notEqual(notificationKey("1", "https://one.example"), notificationKey("1", "https://two.example"));
});

test("Electron 언어별 안내를 제공하고 알 수 없는 언어는 영어를 쓴다", () => {
  assert.equal(stringsForLocale("ko-KR").openBotFather, "BotFather 열기");
  assert.equal(stringsForLocale("si-LK").privateChat, "පුද්ගලික");
  assert.equal(stringsForLocale("fr-FR").openBotFather, "Open BotFather");
  const expectedKeys = Object.keys(stringsForLocale("en-US")).sort();
  for (const locale of ["ko-KR", "vi-VN", "th-TH", "si-LK"]) {
    assert.deepEqual(Object.keys(stringsForLocale(locale)).sort(), expectedKeys);
  }
});
