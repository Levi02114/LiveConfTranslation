/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");
const { EventEmitter } = require("node:events");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { microphoneAllowed } = require("./permissions.cjs");

const {
  extractQuickTunnelUrl,
  listLanAddresses,
  parseHealth,
  pickLanAddress,
} = require("./network.cjs");

test("Electron allows the candidate Host during health checks without publishing it, and clears failures", async () => {
  const candidate = "https://probe-only.trycloudflare.com";
  let healthy = true;
  let missingBinary = false;
  let checked = 0;
  let child;
  const context = vm.createContext({ require: (name) => {
    if (name === "electron") return { app: { requestSingleInstanceLock: () => false, quit() {} } };
    if (name === "node:child_process") return { spawn: () => {
      child = new EventEmitter();
      child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      child.kill = () => { child.emit("exit", 1); };
      queueMicrotask(() => missingBinary ? child.emit("error", Object.assign(new Error("missing"), { code: "ENOENT" })) : child.stdout.emit("data", candidate));
      return child;
    } };
    return require(name);
  }, process: { argv: [] }, __dirname, URL, console, setTimeout, clearTimeout, clearInterval, AbortSignal,
  fetch: async (url) => {
    checked++;
    assert.equal(url, `${candidate}/api/health`);
    assert.ok(context.desktopAllowedOrigins().includes(candidate));
    assert.equal(context.desktopControlState().origin, "http://127.0.0.1:3000");
    return { ok: healthy, text: async () => JSON.stringify({ service: "live-conf-translation", openMeetings: 0 }) };
  } });
  vm.runInContext(readFileSync(path.join(__dirname, "main.cjs"), "utf8"), context);
  vm.runInContext(`
    desktopSettings = { telegram: { chats: [] } };
    cloudflaredPath = () => 'fake-cloudflared'; cloudflaredConfigPath = () => 'unused';
    selectedLanOrigin = () => 'http://127.0.0.1:3000';
    writeDesktopSettings = () => {}; syncPublicOrigin = () => {}; installApplicationMenu = () => {};
    startTunnelHealthMonitor = () => {}; notifyTelegramUrl = () => {}; delay = async () => {};
  `, context);
  await context.startQuickTunnel({ interactive: false });
  assert.equal(checked, 1);
  assert.equal(context.desktopControlState().origin, candidate);
  vm.runInContext("tunnelStopReason = 'failed'", context);
  child.kill();
  assert.ok(!context.desktopAllowedOrigins().includes(candidate));
  healthy = false;
  const result = await context.runDesktopControl({ action: "start" });
  assert.equal(result.error, "tunnelHealthFailed");
  assert.equal(context.desktopControlState().origin, "http://127.0.0.1:3000");
  assert.ok(!context.desktopAllowedOrigins().includes(candidate));
  missingBinary = true;
  assert.equal((await context.runDesktopControl({ action: "start" })).error, "tunnelBinaryMissing");
  missingBinary = false; healthy = true;
  assert.equal((await context.runDesktopControl({ action: "start" })).error, undefined);
  assert.equal(context.desktopControlState().origin, candidate);
});

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
test("Electron grants audio only to internal input, capture and authenticated admin pages", () => {
  const origin = "http://127.0.0.1:3000";
  const input = `${origin}/in/input-token`;
  assert.equal(microphoneAllowed(input, ["audio"], input, origin), true);
  assert.equal(microphoneAllowed(`${origin}/capture/token`, ["audio"], input, origin), true);
  assert.equal(microphoneAllowed(input, ["video"], input, origin), false);
  assert.equal(microphoneAllowed(input, ["audio", "video"], input, origin), false);
  assert.equal(microphoneAllowed(input, ["audio"], "https://external.invalid", origin), false);
  assert.equal(microphoneAllowed("https://external.invalid/in/token", ["audio"], input, origin), false);
  assert.equal(microphoneAllowed(`${origin}/admin`, ["audio"], `${origin}/admin`, origin), true);
  assert.equal(microphoneAllowed(`${origin}/admin/meetings/id`, ["audio"], `${origin}/admin/meetings/id`, origin), true);
  assert.equal(microphoneAllowed(`${origin}/admin/login`, ["audio"], `${origin}/admin/login`, origin), false);
  assert.equal(microphoneAllowed(`${origin}/out/token`, ["audio"], input, origin), false);
});

test("settings use the browser bridge, hide the native menu and return pairing links without opening host apps", async () => {
  let menu = "unset";
  let fullscreen = false;
  const electron = { app: { requestSingleInstanceLock: () => false, quit() {} },
    BrowserWindow: { fromWebContents: () => ({ isFullScreen: () => fullscreen, setFullScreen: (value) => { fullscreen = value; } }) },
    Menu: { setApplicationMenu: (value) => { menu = value; }, buildFromTemplate: (value) => value } };
  const context = vm.createContext({ require: (name) => {
    if (name === "electron") return electron;
    if (name === "./telegram-bot.cjs") return { createTelegramBot: () => ({ status: () => "ready", pair: async (_mode, open) => { open("https://t.me/test?start=nonce"); } }) };
    return require(name);
  }, process: { argv: [], platform: "win32" }, __dirname, URL, console, setTimeout, clearTimeout });
  vm.runInContext(readFileSync(path.join(__dirname, "main.cjs"), "utf8"), context);
  context.installApplicationMenu(); assert.equal(menu, null);
  const contents = new EventEmitter();
  let reloads = 0;
  contents.reload = () => reloads++;
  contents.reloadIgnoringCache = () => reloads += 10;
  contents.setWindowOpenHandler = () => {};
  context.applyNavigationPolicy(contents);
  const event = { preventDefault() {} };
  contents.emit("before-input-event", event, { type: "keyDown", key: "r", control: true });
  contents.emit("before-input-event", event, { type: "keyDown", key: "F5", shift: true });
  contents.emit("before-input-event", event, { type: "keyDown", key: "F11" });
  assert.equal(reloads, 11); assert.equal(fullscreen, true);
  vm.runInContext(`desktopSettings = { telegram: { tokenEncrypted: 'secret-not-returned', botUsername: 'test', chats: [] } };
    telegramToken = () => 'fake-only'; syncPublicOrigin = () => {};
    tunnelUrl = 'https://active.trycloudflare.com';`, context);
  assert.equal(context.desktopControlState().origin, "https://active.trycloudflare.com");
  assert.equal(JSON.stringify(context.desktopControlState()).includes("secret-not-returned"), false);
  assert.equal((await context.runDesktopControl({ action: "share", origin: "https://external.invalid" })).error, "genericError");
  assert.equal((await context.runDesktopControl({ action: "stop", confirmed: false })).error, "genericError");
  assert.equal((await context.runDesktopControl({ action: "pair", mode: "private" })).link, "https://t.me/test?start=nonce");
  await context.runDesktopControl({ action: "share", origin: "http://127.0.0.1:3000" });
  assert.equal(context.desktopControlState().origin, "https://active.trycloudflare.com");
});


test("Telegram desktop controls preserve an active tunnel on auto-off and fail closed on startup failure", async () => {
  let operations;
  const context = vm.createContext({ require: (name) => {
    if (name === "electron") return { app: { requestSingleInstanceLock: () => false, quit() {} } };
    if (name === "./telegram-bot.cjs") return { createTelegramBot: (deps) => { operations = deps; return {}; } };
    return require(name);
  }, process: { argv: [] }, __dirname, URL, console, setTimeout, clearTimeout });
  vm.runInContext(readFileSync(path.join(__dirname, "main.cjs"), "utf8"), context);
  vm.runInContext(`
    desktopSettings = { telegram: { chats: [{ id: '1', type: 'private' }] } };
    telegramToken = () => 'fake-only';
    installApplicationMenu = () => {};
    telegramStateChanged = () => {};
    notifyTelegramUrl = () => {};
    startTunnelHealthMonitor = () => {};
    probeServer = async () => ({ state: 'ours' });
    startQuickTunnel = async () => { tunnelUrl = 'https://test.trycloudflare.com'; tunnelState = 'connected'; };
  `, context);
  await operations.perform("auto-on");
  assert.equal(operations.tunnel().auto, true);
  assert.equal(operations.tunnel().state, "connected");
  await operations.perform("auto-off");
  assert.equal(operations.tunnel().auto, false);
  assert.equal(operations.tunnel().url, "https://test.trycloudflare.com");
  vm.runInContext("startQuickTunnel = async () => { tunnelUrl = null; tunnelState = 'off'; };", context);
  await assert.rejects(operations.perform("start-tunnel"), /tunnel_unavailable/);
  vm.runInContext("probeServer = async () => ({ state: 'offline' });", context);
  await assert.rejects(operations.perform("start-tunnel"), /server_unavailable/);
  const child = new EventEmitter();
  child.pid = 123;
  child.kill = () => { child.emit("exit"); };
  context.child = child;
  vm.runInContext(`tunnelProcess = child; stopQuickTunnel = () => { telegramSettings().autoTunnel = false; tunnelProcess = null; child.kill(); };`, context);
  await operations.perform("stop-tunnel");
  assert.equal(operations.tunnel().identity, null);
  assert.equal(operations.tunnel().auto, false);
});
