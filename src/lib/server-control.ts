import { spawn, type ChildProcess } from "node:child_process";
import { devNull, networkInterfaces } from "node:os";
import { z } from "zod";
import { createTelegramBot } from "../../electron/telegram-bot.cjs";
import { extractQuickTunnelUrl, listLanAddresses } from "../../electron/network.cjs";
import { decryptSecret, encryptSecret } from "./crypto";
import { type DesktopAction, type DesktopState } from "./desktop-control";
import { desktopOperations } from "./desktop-operations";
import { serverControlEnvironment, serverEnvironment } from "./env";
import { getServerControlSettings, setServerControlSettings } from "./repo";
import { notifyAppSettings } from "./voice-settings";

const storedSchema = z.object({
  origin: z.string().optional(), token: z.string().optional(),
  botId: z.string().optional(), botName: z.string().optional(), botUsername: z.string().optional(),
  autoTunnel: z.boolean().default(false),
  chats: z.array(z.object({ id: z.string(), title: z.string(), type: z.string(), managementEnabled: z.boolean().optional() })).default([]),
});
type TelegramPayload = {
  chat_id?: string; text?: string; disable_web_page_preview?: boolean;
  offset?: number; limit?: number; timeout?: number; allowed_updates?: string[];
  callback_query_id?: string; scope?: { type: string };
  commands?: { command: string; description: string }[];
  reply_markup?: { inline_keyboard: { text: string; callback_data: string }[][] };
};

/** Reuse the same bot authorization/pairing receiver without loading Electron. */
export function startServerControl() {
  if (globalThis.__liveConfDesktopControl) return;
  const config = serverControlEnvironment();
  const loopback = `http://127.0.0.1:${serverEnvironment().port}`;
  const stored = getServerControlSettings();
  const plain = stored ? decryptSecret(Buffer.from(stored, "base64")) : null;
  const settings = storedSchema.parse(plain ? JSON.parse(plain) : {});
  const save = () => {
    setServerControlSettings(Buffer.from(encryptSecret(JSON.stringify(settings))).toString("base64"));
    notifyAppSettings();
  };
  let child: ChildProcess | null = null;
  let url: string | null = config.publicOrigin;
  let state: DesktopState["tunnel"] = url ? "connected" : "off";
  let starting: Promise<void> | null = null;
  let stopPending = false;
  let disposed = false;
  let recovery: ReturnType<typeof setTimeout> | undefined;
  const addresses = () => [{ origin: loopback, label: "127.0.0.1" }, ...listLanAddresses(networkInterfaces()).map((item: { name: string; address: string }) => ({
    origin: `http://${item.address}:${serverEnvironment().port}`, label: `${item.name} · ${item.address}`,
  }))];
  const origin = () => url ?? (addresses().some((item) => item.origin === settings.origin) ? settings.origin! : addresses()[1]?.origin ?? loopback);
  const strings = () => desktopOperations("ko").strings;
  const previousOrigins = globalThis.__liveConfAllowedOrigins;
  globalThis.__liveConfLocalTunnelProxy = true;
  globalThis.__liveConfAllowedOrigins = () => [...(previousOrigins?.() ?? []), ...(url ? [url] : [])];
  async function request(token: string, method: string, payload: TelegramPayload, timeout = 20_000, signal?: AbortSignal) {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
    });
    const body = await response.json();
    if (!response.ok || !body?.ok) throw Object.assign(new Error("telegram_request_failed"), { code: body?.error_code ?? response.status, retryAfter: body?.parameters?.retry_after });
    return body.result;
  }
  async function notify(text: string) {
    if (!settings.token) return;
    await Promise.allSettled(settings.chats.map((chat) => request(settings.token!, "sendMessage", { chat_id: chat.id, text, disable_web_page_preview: true })));
  }
  function scheduleRecovery() {
    if (!disposed && settings.autoTunnel && !config.publicOrigin && !recovery) {
      state = "recovering";
      recovery = setTimeout(() => { recovery = undefined; void startTunnel().catch(() => {}); }, 10_000);
    }
    notifyAppSettings();
  }
  function startTunnel(): Promise<void> {
    if (config.publicOrigin || state === "connected") return Promise.resolve();
    if (starting) return starting;
    starting = (async () => {
      state = "connecting"; notifyAppSettings();
      const process = spawn(config.cloudflared, ["tunnel", "--config", devNull, "--no-autoupdate", "--url", loopback, "--protocol", "http2"], { windowsHide: true });
      child = process;
      let connected = false;
      try {
        const candidate = await new Promise<string>((resolve, reject) => {
          let log = "";
          const timeout = setTimeout(() => reject(new Error("tunnel_timeout")), 30_000);
          const read = (data: Buffer) => {
            log = (log + data.toString()).slice(-4000);
            const found = extractQuickTunnelUrl(log);
            if (found) { clearTimeout(timeout); resolve(found); }
          };
          process.stdout?.on("data", read); process.stderr?.on("data", read);
          process.once("error", () => { clearTimeout(timeout); reject(new Error("tunnel_start_failed")); });
          process.once("exit", () => {
            clearTimeout(timeout); reject(new Error("tunnel_exited"));
            if (child !== process) return;
            child = null; url = config.publicOrigin; state = "off";
            if (connected && !disposed) void notify(strings().stoppedNotification);
            if (!starting) scheduleRecovery();
            notifyAppSettings();
          });
        });
        url = candidate; // Allow this exact origin before health-checking it.
        let healthy = false;
        for (let attempt = 0; attempt < 10 && child === process; attempt++) {
          try {
            const response = await fetch(`${candidate}/api/health`, { signal: AbortSignal.timeout(5000) });
            healthy = response.ok && (await response.json()).service === "live-conf-translation";
          } catch { /* Retry DNS propagation; never emit raw provider errors. */ }
          if (healthy) break;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        if (!healthy || child !== process) throw new Error("tunnel_health_failed");
        connected = true; state = "connected"; notifyAppSettings();
        void notify(`${strings().initialNotification}\n\n${candidate}`);
      } catch {
        process.kill(); if (child === process) child = null;
        url = config.publicOrigin; state = "off";
        throw new Error("tunnel_failed");
      } finally {
        starting = null;
        if (!connected) scheduleRecovery();
      }
    })();
    return starting;
  }
  function stopTunnel() {
    if (config.publicOrigin) throw new Error("external_tunnel");
    settings.autoTunnel = false; save(); clearTimeout(recovery); recovery = undefined;
    child?.kill(); url = null; state = "off"; notifyAppSettings();
  }
  const bot = createTelegramBot({
    token: () => settings.token, settings: () => settings, save, request, strings,
    snapshot: () => desktopOperations("ko"), changed: notifyAppSettings,
    openMeetings: async () => desktopOperations("ko").sessions.length,
    tunnel: () => {
      const current = globalThis.__liveConfDesktopControl?.snapshot();
      return { state: current?.tunnel ?? state, url: current?.tunnel === "connected" ? current.origin : url,
        origin: current?.origin ?? origin(), auto: current?.connection?.auto ?? settings.autoTunnel,
        busy: Boolean(starting) || stopPending || Boolean(current?.connection?.busy), identity: current?.connection?.mode === "named" ? current.origin : child?.pid ?? null };
    },
    perform: async (action: string) => {
      if (globalThis.__liveConfDesktopControl?.snapshot().connection) {
        const result = await globalThis.__liveConfDesktopControl.run(action === "stop-tunnel" ? { action: "stop", confirmed: true } :
          action === "auto-on" || action === "auto-off" ? { action: "auto", enabled: action === "auto-on" } : { action: "start" });
        if (result.error) throw new Error(result.error);
        return;
      }
      if (config.publicOrigin) throw new Error("external_tunnel");
      if (action === "stop-tunnel") return stopTunnel();
      if (action === "auto-off") { settings.autoTunnel = false; save(); clearTimeout(recovery); recovery = undefined; return; }
      if (action === "auto-on") { settings.autoTunnel = true; save(); }
      await startTunnel();
    },
  });
  async function run(action: DesktopAction): Promise<{ error?: string; link?: string }> {
    if (stopPending) return { error: "busy" };
    switch (action.action) {
      case "share":
        if (!addresses().some((item) => item.origin === action.origin)) return { error: "genericError" };
        settings.origin = action.origin; save(); break;
      case "start": await startTunnel(); break;
      case "stop":
        if (config.publicOrigin) return { error: "genericError" };
        stopPending = true;
        setTimeout(() => { try { stopTunnel(); } finally { stopPending = false; } }, 750); break;
      case "auto":
        if (config.publicOrigin) return { error: "genericError" };
        if (action.enabled && (!settings.token || !settings.chats.length)) return { error: "recipientRequired" };
        settings.autoTunnel = action.enabled; save();
        if (action.enabled) void startTunnel().catch(() => {});
        else { clearTimeout(recovery); recovery = undefined; } break;
      case "verify": {
        if (!/^\d{6,20}:[A-Za-z0-9_-]{20,}$/.test(action.token)) return { error: "invalidToken" };
        const verified = await request(action.token, "getMe", {}).catch(() => null);
        if (!verified?.id || !verified.username || !verified.is_bot) return { error: "invalidToken" };
        bot.stop();
        if (settings.botId !== String(verified.id)) { settings.chats = []; settings.autoTunnel = false; clearTimeout(recovery); recovery = undefined; }
        settings.token = action.token; settings.botId = String(verified.id); settings.botName = verified.first_name; settings.botUsername = verified.username;
        save(); void bot.start(); break;
      }
      case "pair":
        if (!settings.token || !settings.botUsername) return { error: "botRequired" };
        return new Promise((resolve) => {
          void bot.pair(action.mode, (link: string) => resolve({ link })).then((error) => resolve(error ? { error: String(error) } : {})).catch(() => resolve({ error: "genericError" }));
        });
      case "test":
        if (!settings.token || !settings.chats.some((chat) => chat.id === action.chatId)) return { error: "genericError" };
        await request(settings.token, "sendMessage", { chat_id: action.chatId, text: strings().testNotification }); break;
      case "remove":
        settings.chats = settings.chats.filter((chat) => chat.id !== action.chatId);
        if (!settings.chats.length) { settings.autoTunnel = false; clearTimeout(recovery); recovery = undefined; }
        save(); break;
      case "management": {
        const chat = settings.chats.find((chat) => chat.id === action.chatId && chat.type === "private");
        if (!chat) return { error: "genericError" };
        chat.managementEnabled = action.enabled; save(); break;
      }
      case "retry": bot.stop(); void bot.start(); break;
    }
    return {};
  }
  const control = { run, notifyOrigin: (value: string) => { void notify(`${strings().initialNotification}\n\n${value}`); }, snapshot: (): DesktopState => ({
    origin: origin(), addresses: addresses(), tunnel: state, ca: false, externalTunnel: Boolean(config.publicOrigin),
    telegram: { bot: settings.botUsername ? { name: settings.botName || settings.botUsername, username: settings.botUsername } : null, chats: settings.chats, autoTunnel: settings.autoTunnel, receiver: bot.status() },
  }) };
  globalThis.__liveConfDesktopControl = control;
  void bot.start();
  if (settings.autoTunnel && !config.publicOrigin) void startTunnel().catch(() => {});
  const cleanup = () => { disposed = true; bot.stop(); clearTimeout(recovery); child?.kill(); };
  const terminate = () => { cleanup(); process.exit(0); };
  process.once("SIGTERM", terminate); process.once("SIGINT", terminate);
  process.once("exit", cleanup);
  return { ...control, close: () => { cleanup(); process.removeListener("exit", cleanup); process.removeListener("SIGTERM", terminate); process.removeListener("SIGINT", terminate); globalThis.__liveConfLocalTunnelProxy = false; globalThis.__liveConfDesktopControl = undefined; globalThis.__liveConfAllowedOrigins = previousOrigins; } };
}
