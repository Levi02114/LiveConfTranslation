/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  extractQuickTunnelUrl,
  listLanAddresses,
  parseHealth,
  pickLanAddress,
  toLoopbackBrowserUrl,
} = require("./network.cjs");

test("LAN 주소를 우선하고 없으면 loopback 으로 돌아간다", () => {
  assert.equal(
    pickLanAddress({
      vpn: [{ family: "IPv4", address: "100.64.0.2", internal: false }],
      wifi: [{ family: "IPv4", address: "192.168.11.243", internal: false }],
    }),
    "192.168.11.243",
  );
  assert.equal(pickLanAddress({ lo: [{ family: "IPv4", address: "127.0.0.1", internal: true }] }), "127.0.0.1");
});

test("Electron에서 여는 LAN 링크만 loopback으로 바꾼다", () => {
  assert.equal(
    toLoopbackBrowserUrl("http://192.168.219.199:3000/out/token?x=1", ["192.168.219.199"], 3000),
    "http://127.0.0.1:3000/out/token?x=1",
  );
  assert.equal(
    toLoopbackBrowserUrl("https://calm-river.trycloudflare.com/out/token", ["192.168.219.199"], 3000),
    "https://calm-river.trycloudflare.com/out/token",
  );
});

test("실제 어댑터를 가상 어댑터보다 우선하고 둘 다 선택 목록에 남긴다", () => {
  const interfaces = {
    "VirtualBox Host-Only Network": [
      { family: "IPv4", address: "192.168.56.1", internal: false },
    ],
    "Wi-Fi": [{ family: "IPv4", address: "192.168.11.243", internal: false }],
    zth6rdntfo: [{ family: "IPv4", address: "10.241.22.166", internal: false }],
  };

  assert.equal(pickLanAddress(interfaces), "192.168.11.243");
  assert.deepEqual(listLanAddresses(interfaces), [
    { name: "VirtualBox Host-Only Network", address: "192.168.56.1", virtual: true },
    { name: "Wi-Fi", address: "192.168.11.243", virtual: false },
    { name: "zth6rdntfo", address: "10.241.22.166", virtual: true },
  ]);
});

test("Quick Tunnel 로그에서 공개 URL만 꺼낸다", () => {
  assert.equal(
    extractQuickTunnelUrl("INF +--------------------------------+ https://calm-river.trycloudflare.com"),
    "https://calm-river.trycloudflare.com",
  );
  assert.equal(extractQuickTunnelUrl("INF 연결 준비 중"), null);
});

test("상태 응답에서 진행 중인 세션 수를 읽는다", () => {
  assert.deepEqual(
    parseHealth('{"service":"live-conf-translation","openMeetings":2}'),
    { openMeetings: 2 },
  );
  assert.equal(parseHealth('{"service":"another-service","openMeetings":2}'), null);
});
