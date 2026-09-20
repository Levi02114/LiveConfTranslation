/* eslint-disable @typescript-eslint/no-require-imports */
const { randomBytes } = require("node:crypto");
const { pairingChat, retryDelay } = require("./telegram.cjs");

const COMMANDS = ["start", "menu", "help"];

function authorized(chats, chat, user) {
  return chat?.type === "private" && String(user?.id) === String(chat.id) &&
    chats.some((entry) => entry.type === "private" && entry.id === String(chat.id) && entry.managementEnabled === true);
}

/** One receiver owns pairing and commands. Dependencies are the existing desktop operations. */
function createTelegramBot(deps) {
  let receiver = null;
  let pairing = null;
  let busy = false;
  let receiverState = "waiting";
  const buttons = new Map();
  const lastRequests = new Map();

  function state(value) { receiverState = value; deps.changed?.(); }
  function stop() {
    const current = receiver;
    receiver = null;
    current?.controller.abort();
    current?.ready(false);
    pairing?.finish("genericError");
    buttons.clear();
    lastRequests.clear();
    receiverState = "waiting";
  }

  function valid(actor) {
    return receiver === actor.receiver && !actor.receiver.controller.signal.aborted &&
      authorized(deps.settings().chats, actor.chat, actor.user);
  }

  function button(actor, text, action, extra = {}, ttl = 20 * 60_000) {
    for (const [key, value] of buttons) if (value.expires <= Date.now()) buttons.delete(key);
    // Bounded UI handles, not durable commands. Old menus can always be reopened.
    while (buttons.size >= 500) buttons.delete(buttons.keys().next().value);
    const id = randomBytes(12).toString("hex");
    buttons.set(id, { actor: String(actor.chat.id), action, ...extra, expires: Date.now() + ttl });
    return { text, callback_data: id };
  }

  async function send(actor, text, rows = []) {
    if (!valid(actor)) return;
    const characters = [...text];
    do {
      const chunk = characters.splice(0, 3500).join("");
      const payload = {
        chat_id: actor.chat.id, text: chunk || "—", disable_web_page_preview: true,
      };
      if (!characters.length) payload.reply_markup = { inline_keyboard: rows };
      await deps.request(actor.receiver.token, "sendMessage", payload, 20_000, actor.receiver.controller.signal);
      if (!valid(actor)) return;
    } while (characters.length);
  }

  function navigation(actor, refresh, extra = {}) {
    const s = deps.strings();
    return [[button(actor, s.refresh, refresh, extra),
      ...(extra.id ? [button(actor, s.back, "session", { id: extra.id })] : []),
      button(actor, s.menu, "menu")]];
  }

  async function show(actor, action, data = {}) {
    if (!valid(actor)) return;
    const s = deps.strings();
    if (action === "menu") return send(actor, s.menu, [
      [button(actor, s.sessions, "sessions"), button(actor, s.stats, "sessions")],
      [button(actor, s.tunnel, "tunnel"), button(actor, s.help, "help")],
    ]);
    if (action === "help") return send(actor, s.helpText, [[button(actor, s.menu, "menu")]]);
    if (action === "tunnel") {
      const tunnel = deps.tunnel();
      const status = { off: s.tunnelStatusOff, connecting: s.tunnelStatusConnecting, connected: s.tunnelStatusConnected, recovering: s.tunnelStatusRecovering }[tunnel.state];
      const rows = [[button(actor, s.tunnelStart, "start-tunnel")],
        [button(actor, tunnel.auto ? s.autoOff : s.autoOn, tunnel.auto ? "auto-off" : "auto-on")]];
      if (tunnel.state !== "off") rows.push([button(actor, s.tunnelStop, "ask-stop")]);
      return send(actor, `${status}\n${tunnel.url || s.noUrl}\n${s.autoLabel}: ${tunnel.auto ? s.enabled : s.disabled}`,
        [...rows, ...navigation(actor, "tunnel")]);
    }
    if (action === "ask-stop") {
      const count = deps.openMeetings ? await deps.openMeetings() : deps.snapshot()?.sessions.length;
      return send(actor, s.stopWarning.replace("{count}", String(count ?? "—")), [[
        button(actor, s.confirmStop, "stop-tunnel", { tunnelIdentity: deps.tunnel().identity }, 60_000),
        button(actor, s.cancel, "tunnel"),
      ]]);
    }
    const snapshot = deps.snapshot();
    if (!snapshot) return send(actor, s.serverUnavailable, [[button(actor, s.menu, "menu")]]);
    const page = Math.max(0, Number.isSafeInteger(data.page) ? data.page : 0);
    if (action === "sessions") {
      const offset = page * 8;
      const selected = snapshot.sessions.slice(offset, offset + 8);
      const rows = selected.map((session) => [button(actor, session.title.slice(0, 100), "session", { id: session.id })]);
      const pager = [];
      if (page) pager.push(button(actor, s.previous, "sessions", { page: page - 1 }));
      if (snapshot.sessions.length > offset + 8) pager.push(button(actor, s.next, "sessions", { page: page + 1 }));
      if (pager.length) rows.push(pager);
      return send(actor, selected.length ? s.sessions : s.noSessions, [...rows, ...navigation(actor, "sessions")]);
    }
    const session = snapshot.sessions.find((entry) => entry.id === data.id);
    if (!session) return send(actor, s.sessionGone, [[button(actor, s.sessions, "sessions")]]);
    if (action === "session") return send(actor, session.title, [
      [button(actor, s.links, "links", { id: session.id }), button(actor, s.stats, "stats", { id: session.id })],
      [button(actor, s.sessions, "sessions"), button(actor, s.menu, "menu")],
    ]);
    if (action === "stats") {
      const counts = session.counts;
      const lines = counts.languages.map((row) => `${session.languages.find((lang) => lang.code === row.lang)?.label || row.lang}: ${s.inputCount} ${row.input} / ${s.outputCount} ${row.output}`);
      return send(actor, [session.title, `${s.connections}: ${counts.total}`, ...lines,
        `${s.combinedInputCount}: ${counts.combinedInput}`, `${s.combinedCount}: ${counts.combined}`, `${s.captureCount}: ${counts.capture}`,
        s.countNotice, new Date(snapshot.at).toISOString()].join("\n"), navigation(actor, "stats", { id: session.id }));
    }
    if (action === "links") {
      const tunnel = deps.tunnel();
      const labels = { input: s.inputCount, output: s.outputCount, "combined-input": s.combinedInputCount, combined: s.combinedCount, capture: s.captureCount };
      const links = session.pages.map((entry) => ({
        text: `${labels[entry.kind]}${entry.lang ? ` · ${session.languages.find((lang) => lang.code === entry.lang)?.nativeName || entry.lang}` : ""}`,
        url: new URL(entry.path, tunnel.origin).href,
      }));
      const combined = session.pages.find((entry) => entry.kind === "combined");
      if (combined) links.push(
        { text: s.participantGuide, url: new URL(`/join/${combined.token}`, tunnel.origin).href },
        { text: s.inputGuide, url: new URL(`/join/input/${combined.token}`, tunnel.origin).href },
      );
      const pager = [];
      if (page) pager.push(button(actor, s.previous, "links", { id: session.id, page: page - 1 }));
      if (links.length > (page + 1) * 8) pager.push(button(actor, s.next, "links", { id: session.id, page: page + 1 }));
      return send(actor, `${session.title}${tunnel.url ? "" : `\n${s.localOnly}`}`,
        [...links.slice(page * 8, (page + 1) * 8).map((link) => [link]), ...(pager.length ? [pager] : []), ...navigation(actor, "links", { id: session.id, page })]);
    }
  }

  async function dispatch(current, update) {
    if (receiver !== current) return;
    if (pairing) {
      const chat = pairingChat(update, pairing.nonce, pairing.mode);
      if (chat && (chat.type !== "private" || String(update.message.from?.id) === chat.id)) {
        const settings = deps.settings();
        const previous = settings.chats.find((entry) => entry.id === chat.id);
        settings.chats = [...settings.chats.filter((entry) => entry.id !== chat.id), {
          ...chat, managementEnabled: chat.type === "private" && previous?.managementEnabled === true,
        }];
        deps.save();
        pairing.finish(null);
        return;
      }
    }
    const query = update.callback_query;
    const message = query?.message || update.message;
    const actor = { receiver: current, chat: message?.chat, user: query?.from || message?.from };
    if (query) await deps.request(current.token, "answerCallbackQuery", { callback_query_id: query.id }, 10_000, current.controller.signal).catch(() => {});
    if (actor.chat?.type !== "private") return;
    const command = /^\/(start|menu|help)(?:@([A-Za-z0-9_]+))?\s*$/.exec(message?.text || "");
    if (command?.[2] && command[2].toLowerCase() !== deps.settings().botUsername?.toLowerCase()) return;
    if (!query && !message?.text?.startsWith("/")) return;
    const chatId = String(actor.chat.id);
    const now = Date.now();
    // Bound unsolicited replies and repeated taps without slowing independent chats.
    if (now - (lastRequests.get(chatId) || 0) < 750) return;
    while (lastRequests.size >= 500) lastRequests.delete(lastRequests.keys().next().value);
    lastRequests.set(chatId, now);
    if (!valid(actor)) {
      if (!query && command && String(actor.user?.id) === chatId) await deps.request(current.token, "sendMessage", {
        chat_id: actor.chat.id, text: deps.strings().unauthorized,
      }, 10_000, current.controller.signal);
      return;
    }
    let action = command ? command[1] === "help" ? "help" : "menu" : "unknown";
    let data = {};
    if (query) {
      data = buttons.get(query.data);
      if (!data || data.actor !== chatId || data.expires <= now) return send(actor, deps.strings().expired);
      buttons.delete(query.data);
      action = data.action;
    }
    if (["start-tunnel", "stop-tunnel", "auto-on", "auto-off"].includes(action)) {
      if (busy || deps.tunnel().busy) return send(actor, deps.strings().busy);
      if (action === "stop-tunnel" && data.tunnelIdentity !== deps.tunnel().identity) return send(actor, deps.strings().expired);
      busy = true;
      // Keep receiving updates while cloudflared starts; callers see a busy response.
      void (async () => {
        try {
          await send(actor, deps.strings().working);
          if (!valid(actor)) return;
          await deps.perform(action);
          await send(actor, deps.strings().done);
          await show(actor, "tunnel");
        } catch {
          await send(actor, deps.strings().genericError).catch(() => {});
        } finally { busy = false; }
      })();
      return;
    }
    if (action === "unknown") return send(actor, deps.strings().unknown);
    await show(actor, action, data);
  }

  function start() {
    if (receiver) return receiver.promise;
    const token = deps.token();
    if (!token) return Promise.resolve(false);
    let ready;
    const promise = new Promise((resolve) => { ready = resolve; });
    const current = { token, controller: new AbortController(), ready, promise };
    receiver = current;
    state("waiting");
    void (async () => {
      let offset = 0;
      let initialized = false;
      let attempt = 0;
      while (receiver === current && !current.controller.signal.aborted) {
        try {
          if (!initialized) {
            const webhook = await deps.request(token, "getWebhookInfo", {}, 20_000, current.controller.signal);
            if (webhook?.url) { state("conflict"); ready(false); return; }
            const initial = await deps.request(token, "getUpdates", { offset: -1, limit: 1, timeout: 0, allowed_updates: ["message", "callback_query"] }, 20_000, current.controller.signal);
            offset = initial.length ? initial.at(-1).update_id + 1 : 0;
            initialized = true;
            const s = deps.strings();
            await deps.request(token, "setMyCommands", { scope: { type: "all_private_chats" }, commands: COMMANDS.map((command) => ({ command, description: (command === "help" ? s.help : s.menu).slice(0, 256) })) }, 20_000, current.controller.signal).catch(() => {});
          }
          if (receiver !== current || current.controller.signal.aborted) return;
          ready(true);
          if (receiverState !== "ready") state("ready");
          const updates = await deps.request(token, "getUpdates", { offset, limit: 30, timeout: 15, allowed_updates: ["message", "callback_query"] }, 20_000, current.controller.signal);
          attempt = 0;
          for (const update of updates) {
            if (update.update_id < offset) continue;
            offset = update.update_id + 1;
            await dispatch(current, update).catch(() => {});
          }
        } catch (error) {
          if (current.controller.signal.aborted || receiver !== current) return;
          if (error.code === 409 || error.code === 401) { state(error.code === 401 ? "invalid-token" : "conflict"); ready(false); return; }
          state("waiting");
          const wait = Math.min(60_000, error.retryAfter ? error.retryAfter * 1_000 : retryDelay(attempt++));
          await new Promise((resolve) => {
            const done = () => { clearTimeout(timer); current.controller.signal.removeEventListener("abort", done); resolve(); };
            const timer = setTimeout(done, wait);
            current.controller.signal.addEventListener("abort", done, { once: true });
          });
        }
      }
    })();
    return promise;
  }

  async function pair(mode, open = deps.open) {
    if (pairing) return "genericError";
    if (receiverState === "conflict") return "pollingConflict";
    if (receiverState === "invalid-token") return "invalidToken";
    // Start commands are generated only after the stale update queue is drained.
    const ready = await Promise.race([start(), new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 20_000); timer.unref?.();
    })]);
    if (!ready) return "genericError";
    return new Promise((resolve) => {
      const nonce = randomBytes(18).toString("base64url");
      const timer = setTimeout(() => pairing?.finish("pairingTimeout"), 120_000);
      pairing = { nonce, mode, finish: (error) => { clearTimeout(timer); pairing = null; resolve(error); } };
      open(`https://t.me/${deps.settings().botUsername}?${mode === "private" ? "start" : "startgroup"}=${nonce}`);
    });
  }

  return { start, stop, pair, status: () => receiverState };
}

module.exports = { COMMANDS, authorized, createTelegramBot };
