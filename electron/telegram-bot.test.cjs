/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");
const { setTimeout: delay } = require("node:timers/promises");
const { createTelegramBot, authorized, COMMANDS } = require("./telegram-bot.cjs");
const { stringsForLocale } = require("./telegram.cjs");

test("private approval, help, current links, one receiver, pairing, one-shot controls and stale updates", async (t) => {
  let now = 1_800_000_000_000;
  t.mock.method(Date, "now", () => now);
  const settings = { botUsername: "test_bot", chats: [
    { id: "1", type: "private", managementEnabled: true },
    { id: "2", type: "private" }, { id: "-3", type: "group", managementEnabled: true },
  ] };
  assert.equal(authorized(settings.chats, { id: 1, type: "private" }, { id: 1 }), true);
  assert.equal(authorized(settings.chats, { id: 2, type: "private" }, { id: 2 }), false);
  assert.equal(authorized(settings.chats, { id: 1, type: "private" }, { id: 2 }), false);
  assert.equal(authorized(settings.chats, { id: -3, type: "group" }, { id: 1 }), false);
  const messages = [], actions = [], requests = [];
  const tunnel = { state: "connected", url: "https://first.trycloudflare.com", origin: "https://first.trycloudflare.com", auto: true, identity: 5, busy: false };
  const snapshot = { at: now, sessions: [{ id: "session-one", title: "Session one", languages: [{ code: "ko", nativeName: "한국어", label: "한국어" }],
    counts: { total: 2, languages: [{ lang: "ko", input: 1, output: 1 }], combined: 0, combinedInput: 0, capture: 0 },
    pages: [{ kind: "output", lang: "ko", path: "/out/test-token" }, { kind: "combined", path: "/all/combined-token", token: "combined-token" }],
  }] };
  let pending, active = 0, maxActive = 0, opened = "", lastId = 100, releaseAction, failAction = false;
  const bot = createTelegramBot({
    token: () => "test-only-token", settings: () => settings, save() {}, strings: () => stringsForLocale("ko"),
    snapshot: () => snapshot, tunnel: () => tunnel, open: (url) => { opened = url; },
    perform: async (action) => { actions.push(action); if (failAction) throw new Error("fake tunnel failure"); if (releaseAction) await new Promise((resolve) => { releaseAction = resolve; }); },
    request: async (_token, method, payload, _timeout, signal) => {
      requests.push({ method, payload });
      if (method === "getWebhookInfo") return {};
      if (method === "getUpdates") {
        if (payload.offset === -1) return [{ update_id: 100, message: { text: "/menu", chat: { id: 1, type: "private" }, from: { id: 1 } } }];
        active++; maxActive = Math.max(maxActive, active);
        return new Promise((resolve, reject) => {
          const finish = (updates, error) => { active--; pending = null; signal.removeEventListener("abort", abort); if (error) reject(error); else resolve(updates); };
          const abort = () => finish(null, new Error("aborted"));
          signal.addEventListener("abort", abort, { once: true });
          pending = (updates) => finish(updates);
        });
      }
      if (method === "sendMessage") messages.push(payload);
      return {};
    },
  });
  async function wait(check) {
    for (let index = 0; index < 100; index++) { if (check()) return; await delay(5); }
    assert.fail("fake bot did not settle");
  }
  async function update(value, id) {
    await wait(() => pending);
    now += 1000;
    pending([{ update_id: id ?? ++lastId, ...value }]);
    await wait(() => pending);
  }
  const command = (text, id = 1, type = "private") => update({ message: { text, chat: { id, type }, from: { id } } });
  const latestButton = (label) => {
    const button = messages.at(-1)?.reply_markup?.inline_keyboard.flat().find((row) => row.text === label);
    assert.ok(button, `button: ${label}`); return button.callback_data;
  };
  const click = (data, user = 1, chat = 1) => update({ callback_query: { id: `q${lastId}`, data, from: { id: user }, message: { chat: { id: chat, type: "private" } } } });
  try {
    assert.equal(await bot.start(), true);
    await wait(() => pending);
    assert.equal(messages.length, 0, "queued startup messages are discarded");
    assert.deepEqual(requests.find((r) => r.method === "setMyCommands").payload.commands.map((row) => row.command), COMMANDS);
    await command("/help", 2);
    assert.equal(messages.at(-1).text, stringsForLocale("ko").unauthorized);
    const beforeGroup = messages.length;
    await command("/menu", -3, "group");
    assert.equal(messages.length, beforeGroup);
    await command("/help");
    assert.ok(messages.at(-1).text.includes("TTS"));
    assert.ok(messages.at(-1).text.includes("/menu"));
    await click(latestButton("관리 메뉴"));
    await click(latestButton("활성 세션"));
    await click(latestButton("Session one"));
    await click(latestButton("페이지 링크"));
    assert.ok(messages.at(-1).reply_markup.inline_keyboard.flat().some((row) => row.url === "https://first.trycloudflare.com/out/test-token"));
    const refresh = latestButton("새로고침");
    tunnel.url = tunnel.origin = "https://second.trycloudflare.com";
    await click(refresh);
    assert.ok(messages.at(-1).reply_markup.inline_keyboard.flat().some((row) => row.url === "https://second.trycloudflare.com/join/combined-token"));
    const staleSessionButton = latestButton("새로고침");
    const saved = snapshot.sessions;
    snapshot.sessions = [];
    await click(staleSessionButton);
    assert.equal(messages.at(-1).text, stringsForLocale("ko").sessionGone);
    snapshot.sessions = saved;
    await command("/menu");
    await click(latestButton("Cloudflare"));
    await click(latestButton("공개 터널 종료"));
    const confirm = latestButton("터널 종료 확인");
    assert.equal(actions.length, 0);
    await click(confirm, 2);
    assert.equal(actions.length, 0);
    await click(confirm);
    await wait(() => actions.length === 1 && messages.at(-1).text.includes("상태:"));
    assert.deepEqual(actions, ["stop-tunnel"]);
    await click(confirm);
    assert.equal(actions.length, 1);
    assert.equal(messages.at(-1).text, stringsForLocale("ko").expired);
    await command("/menu"); await click(latestButton("Cloudflare")); await click(latestButton("공개 터널 종료"));
    const expired = latestButton("터널 종료 확인");
    now += 61_000;
    await click(expired);
    assert.equal(actions.length, 1);
    assert.equal(messages.at(-1).text, stringsForLocale("ko").expired);
    await command("/menu"); await click(latestButton("Cloudflare"));
    const revoke = latestButton("자동 시작·복구 끄기");
    settings.chats[0].managementEnabled = false;
    await click(revoke);
    assert.equal(actions.length, 1);
    settings.chats[0].managementEnabled = true;
    await command("/menu"); await click(latestButton("Cloudflare"));
    const start = latestButton(stringsForLocale("ko").tunnelStart);
    const busyAutoOff = latestButton(stringsForLocale("ko").autoOff);
    releaseAction = true;
    await click(start);
    await wait(() => releaseAction !== true);
    await click(busyAutoOff);
    assert.equal(messages.at(-1).text, stringsForLocale("ko").busy);
    assert.equal(actions.length, 2);
    releaseAction(); releaseAction = null;
    await wait(() => messages.at(-1).text.includes("상태:"));
    await click(latestButton(stringsForLocale("ko").autoOff));
    await wait(() => actions.at(-1) === "auto-off" && messages.at(-1).text.includes("상태:"));
    tunnel.auto = false;
    await command("/menu"); await click(latestButton("Cloudflare"));
    await click(latestButton(stringsForLocale("ko").autoOn));
    await wait(() => actions.at(-1) === "auto-on" && messages.at(-1).text.includes("상태:"));
    failAction = true;
    await click(latestButton(stringsForLocale("ko").tunnelStart));
    await wait(() => messages.at(-1).text === stringsForLocale("ko").genericError);
    failAction = false;
    let browserLink = "";
    const pair = bot.pair("private", (url) => { browserLink = url; });
    await wait(() => browserLink);
    assert.equal(opened, "", "remote pairing never opens a browser on the host");
    const nonce = new URL(browserLink).searchParams.get("start");
    await command(`/start ${nonce}`, 4);
    assert.equal(await pair, null);
    assert.equal(settings.chats.find((row) => row.id === "4").managementEnabled, false);
    assert.equal(maxActive, 1, "pairing shares the command receiver");
    const beforeDuplicate = messages.length;
    await update({ message: { text: "/menu", chat: { id: 1, type: "private" }, from: { id: 1 } } }, 100);
    assert.equal(messages.length, beforeDuplicate);
    await command("/not-a-command");
    assert.ok(messages.at(-1).text.includes("/help"));
    bot.stop();
    await wait(() => active === 0);
  } finally { bot.stop(); }
});

test("webhook conflicts are reported without deleting the webhook", async () => {
  const methods = [];
  const bot = createTelegramBot({ token: () => "fake", request: async (_token, method) => { methods.push(method); return { url: "https://example.invalid/hook" }; } });
  try {
    assert.equal(await bot.start(), false);
    assert.equal(bot.status(), "conflict");
    assert.deepEqual(methods, ["getWebhookInfo"]);
  } finally { bot.stop(); }
});
