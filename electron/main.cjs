/* eslint-disable @typescript-eslint/no-require-imports */
const { randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { z } = require("zod");
const { microphoneAllowed } = require("./permissions.cjs");
const { createTelegramBot } = require("./telegram-bot.cjs");

const { app, BrowserWindow, clipboard, dialog, Menu, safeStorage, session, shell } = require("electron");

const {
  extractQuickTunnelUrl,
  listLanAddresses,
  parseHealth,
  pickLanAddress,
} = require("./network.cjs");
const { applyLocalAiEnvironment, ensureLocalCertificate, installLocalAi, installedLocalAi, stringsFor: localAiStrings } = require("./local-ai.cjs");
const {
  notificationKey,
  retryDelay,
  shouldNotifyTunnelStopped,
  shouldReplaceTunnel,
  shouldSendTelegramUrl,
  stringsForLocale,
} = require("./telegram.cjs");

const PORT = 3000;
const LOOPBACK_ORIGIN = `http://127.0.0.1:${PORT}`;
const ADMIN_LANG_COOKIE = "lct_admin_lang";
const secureWebPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};

const adminOrigin = LOOPBACK_ORIGIN;
let mainWindow = null;
let uiLocale = "ko";
let observingUiLocale = false;
let desktopSettings = null;
let desktopSettingsPath = null;
let lanAddresses = [];
let preferredShareOrigin = null;
let shareOrigin = LOOPBACK_ORIGIN;
let tunnelProcess = null;
let tunnelStarting = false;
let desktopStopPending = false;
let tunnelInteractive = false;
let tunnelStopReason = null;
let tunnelUrl = null;
let pendingTunnelUrl = null;
let tunnelStartError = null;
let tunnelState = "off";
let tunnelHealthTimer = null;
let tunnelRestartTimer = null;
let tunnelRetryAttempt = 0;
let publicHealthFailures = 0;
let lastTelegramNotificationUrl = null;
let unavailableTunnelUrl = null;
const sentTelegramNotifications = new Set();
const telegramNotificationTimers = new Map();
const telegramTokenSchema = z.string().trim().regex(/^\d{6,20}:[A-Za-z0-9_-]{20,}$/);
let quitApproved = false;
let quitPromptOpen = false;

function desktopSnapshot() {
  try { return globalThis.__liveConfDesktopOperations?.(uiLocale) ?? null; } catch { return null; }
}

function telegramStrings() {
  return desktopSnapshot()?.strings ?? stringsForLocale(uiLocale);
}

function telegramStateChanged() {
  globalThis.__liveConfSettingsChanged?.();
}

const telegramBot = createTelegramBot({
  token: telegramToken,
  settings: telegramSettings,
  save: writeDesktopSettings,
  request: telegramRequest,
  strings: telegramStrings,
  snapshot: desktopSnapshot,
  open: openInBrowser,
  changed: telegramStateChanged,
  openMeetings: async () => { const health = await probeServer(); return health.state === "ours" ? health.openMeetings : null; },
  tunnel: () => {
    const current = globalThis.__liveConfDesktopControl?.snapshot();
    if (current?.connection) return { state: current.tunnel, url: current.tunnel === "connected" ? current.origin : null,
      origin: current.origin, auto: current.connection.auto, busy: current.connection.busy,
      identity: current.connection.mode === "named" ? current.origin : tunnelProcess?.pid ?? null };
    return ({
    state: tunnelState, url: tunnelState === "connected" ? tunnelUrl : null,
    origin: tunnelState === "connected" && tunnelUrl ? tunnelUrl : shareOrigin,
    auto: Boolean(telegramSettings().autoTunnel), busy: tunnelStarting,
    identity: tunnelProcess?.pid ?? null,
    });
  },
  perform: async (action) => {
    if (globalThis.__liveConfDesktopControl?.snapshot().connection) {
      const result = await globalThis.__liveConfDesktopControl.run(action === "stop-tunnel" ? { action: "stop", confirmed: true } :
        action === "auto-on" || action === "auto-off" ? { action: "auto", enabled: action === "auto-on" } : { action: "start" });
      if (result.error) throw new Error(result.error);
      return;
    }
    if (action === "auto-off") { setAutoTunnelEnabled(false); return; }
    if (action === "auto-on") {
      const error = setAutoTunnelEnabled(true, false);
      if (error) throw new Error(error);
    }
    if (action === "start-tunnel" || action === "auto-on") {
      if ((await probeServer()).state !== "ours") throw new Error("server_unavailable");
      await startQuickTunnel({ interactive: false });
      if (!tunnelUrl || tunnelState !== "connected") throw new Error("tunnel_unavailable");
      return;
    }
    if (action === "stop-tunnel") {
      const child = tunnelProcess;
      if (!child) { stopQuickTunnel("manual"); return; }
      await new Promise((resolve, reject) => {
        const done = () => { clearTimeout(timer); resolve(); };
        const timer = setTimeout(() => { child.removeListener("exit", done); reject(new Error("tunnel_stop_timeout")); }, 10_000);
        child.once("exit", done);
        stopQuickTunnel("manual");
      });
    }
  },
});

function probeServer() {
  return new Promise((resolve) => {
    const request = http.get(`${LOOPBACK_ORIGIN}/api/health`, { timeout: 1200 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
      });
      response.on("end", () => {
        const health = parseHealth(body);
        resolve(health ? { state: "ours", ...health } : { state: "occupied", openMeetings: 0 });
      });
    });
    request.on("timeout", () => {
      request.destroy();
      resolve({ state: "occupied", openMeetings: 0 });
    });
    request.on("error", (error) => {
      resolve({
        state: error.code === "ECONNREFUSED" ? "free" : "occupied",
        openMeetings: 0,
      });
    });
  });
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await probeServer()).state === "ours") return;
    await delay(100);
  }
  throw new Error("로컬 서버가 10초 안에 시작되지 않았습니다.");
}

function loadDesktopSettings() {
  const userData = app.getPath("userData");
  desktopSettingsPath = path.join(userData, "desktop-settings.json");
  mkdirSync(userData, { recursive: true });
  if (existsSync(desktopSettingsPath)) desktopSettings = JSON.parse(readFileSync(desktopSettingsPath, "utf8"));
  if (app.isPackaged) {
    const localAi = installedLocalAi(process.resourcesPath);
    if (localAi) desktopSettings = { ...desktopSettings, localAi };
  }
  if (!desktopSettings) return;
  preferredShareOrigin = desktopSettings.preferredOrigin ?? null;
  applyLocalAiEnvironment(desktopSettings);
}

function writeDesktopSettings() {
  if (!desktopSettingsPath || !desktopSettings) return;
  writeFileSync(desktopSettingsPath, `${JSON.stringify(desktopSettings, null, 2)}\n`, { mode: 0o600 });
  globalThis.__liveConfSettingsChanged?.();
}

function telegramSettings() {
  desktopSettings ??= {};
  desktopSettings.telegram ??= { chats: [], autoTunnel: false };
  desktopSettings.telegram.chats = Array.isArray(desktopSettings.telegram.chats)
    ? desktopSettings.telegram.chats
    : [];
  return desktopSettings.telegram;
}

function telegramToken() {
  const encrypted = telegramSettings().tokenEncrypted;
  if (!encrypted || !safeStorage.isEncryptionAvailable()) return null;
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, "base64"));
  } catch {
    return null;
  }
}

function telegramNotificationsConfigured() {
  return Boolean(telegramToken() && telegramSettings().chats.length > 0);
}

function telegramSetupState() {
  const settings = telegramSettings();
  return {
    locale: uiLocale,
    strings: telegramStrings(),
    bot: settings.botId && settings.botUsername
      ? { id: settings.botId, name: settings.botName || settings.botUsername, username: settings.botUsername }
      : null,
    chats: settings.chats,
    autoTunnel: Boolean(settings.autoTunnel),
    receiver: telegramBot.status(),
  };
}

function telegramResult(error = null) {
  return error ? { ok: false, error } : { ok: true, state: telegramSetupState() };
}

function desktopAllowedOrigins() {
  return [shareOrigin, tunnelUrl, pendingTunnelUrl].filter(Boolean);
}

function desktopControlState() {
  const telegram = telegramSetupState();
  return { origin: tunnelUrl || shareOrigin,
    addresses: lanAddresses.length ? lanAddresses.map((item) => ({ origin: lanOrigin(item.address), label: `${item.name} · ${item.address}` }))
      : [{ origin: LOOPBACK_ORIGIN, label: "127.0.0.1" }],
    tunnel: tunnelState, ca: Boolean(desktopSettings?.localHttps),
    telegram: { bot: telegram.bot, chats: telegram.chats, autoTunnel: telegram.autoTunnel, receiver: telegram.receiver } };
}

async function runDesktopControl(command) {
  if (desktopStopPending) return { error: "genericError" };
  const settings = telegramSettings();
  switch (command.action) {
    case "share":
      if (!desktopControlState().addresses.some((item) => item.origin === command.origin)) return { error: "genericError" };
      selectShareOrigin(command.origin); break;
    case "start":
      await startQuickTunnel({ interactive: false });
      if (!tunnelUrl) return { error: tunnelStartError || "tunnelExited" };
      break;
    case "stop":
      if (command.confirmed !== true) return { error: "genericError" };
      // Acknowledge the request before severing the requesting public connection.
      desktopStopPending = true;
      setTimeout(() => { try { stopQuickTunnel("manual"); } finally { desktopStopPending = false; } }, 750);
      break;
    case "auto": return { error: setAutoTunnelEnabled(command.enabled) || undefined };
    case "verify": {
      const token = telegramTokenSchema.safeParse(command.token);
      if (!token.success) return { error: "invalidToken" };
      const result = await verifyTelegramBot(token.data);
      return { error: result.error || undefined };
    }
    case "pair":
      if (!telegramToken() || !settings.botUsername) return { error: "botRequired" };
      return new Promise((resolve) => {
        // The nonce is returned only to the browser initiating pairing, never broadcast.
        void telegramBot.pair(command.mode, (link) => resolve({ link }))
          .then((error) => { resolve({ error: error || undefined }); telegramStateChanged(); })
          .catch(() => resolve({ error: "genericError" }));
      });
    case "test": {
      if (!settings.chats.some((chat) => chat.id === command.chatId)) return { error: "genericError" };
      const result = await testTelegramChat(command.chatId);
      return { error: result.error || undefined };
    }
    case "remove":
      settings.chats = settings.chats.filter((chat) => chat.id !== command.chatId);
      if (!settings.chats.length) { settings.autoTunnel = false; clearTunnelTimers(); }
      writeDesktopSettings(); break;
    case "management": {
      const chat = settings.chats.find((item) => item.id === command.chatId && item.type === "private");
      if (!chat) return { error: "genericError" };
      chat.managementEnabled = command.enabled;
      writeDesktopSettings(); break;
    }
    case "retry": telegramBot.stop(); void telegramBot.start(); break;
    default: return { error: "genericError" };
  }
  return {};
}

async function telegramRequest(token, method, payload, timeout = 20_000, signal) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
  });
  let body;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok || !body?.ok) {
    const error = new Error("telegram_request_failed");
    error.retryAfter = body?.parameters?.retry_after;
    error.code = body?.error_code ?? response.status;
    throw error;
  }
  return body.result;
}

async function verifyTelegramBot(token) {
  const value = token.trim();
  if (!value || !safeStorage.isEncryptionAvailable()) {
    return telegramResult(value ? "encryptionUnavailable" : "invalidToken");
  }
  try {
    const bot = await telegramRequest(value, "getMe", {});
    if (!bot?.id || !bot?.username) return telegramResult("invalidToken");
    telegramBot.stop();
    const settings = telegramSettings();
    const changedBot = settings.botId !== String(bot.id);
    settings.tokenEncrypted = safeStorage.encryptString(value).toString("base64");
    settings.botId = String(bot.id);
    settings.botName = bot.first_name || bot.username;
    settings.botUsername = bot.username;
    if (changedBot) {
      settings.chats = [];
      settings.autoTunnel = false;
    }
    writeDesktopSettings();
    installApplicationMenu();
    void telegramBot.start();
    return telegramResult();
  } catch {
    return telegramResult("invalidToken");
  }
}


async function sendTelegramMessage(chatId, text) {
  const token = telegramToken();
  if (!token) throw new Error("telegram_token_missing");
  return telegramRequest(token, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
}

function telegramNotificationText(url, changed = false) {
  const strings = telegramStrings();
  const issued = new Intl.DateTimeFormat(uiLocale, { dateStyle: "medium", timeStyle: "medium" }).format(new Date());
  return `${changed ? strings.changedNotification : strings.initialNotification}\n\n${url}\n\n${strings.notificationTime}: ${issued}`;
}

function sendTelegramNotification(chat, key, text, isCurrent, attempt = 0) {
  if (sentTelegramNotifications.has(key) || !isCurrent()) {
    telegramNotificationTimers.delete(key);
    return;
  }
  void sendTelegramMessage(chat.id, text).then(() => {
    sentTelegramNotifications.add(key);
    const timer = telegramNotificationTimers.get(key);
    if (timer) clearTimeout(timer);
    telegramNotificationTimers.delete(key);
  }).catch((error) => {
    if (!isCurrent()) return;
    const delayMs = Number.isFinite(error.retryAfter) ? error.retryAfter * 1_000 : retryDelay(attempt);
    const timer = setTimeout(() => sendTelegramNotification(chat, key, text, isCurrent, attempt + 1), delayMs);
    telegramNotificationTimers.set(key, timer);
  });
}

function sendTelegramUrl(chat, url, changed) {
  sendTelegramNotification(
    chat,
    notificationKey(chat.id, url),
    telegramNotificationText(url, changed),
    () => shouldSendTelegramUrl(Boolean(telegramToken()), telegramSettings().chats.length, globalThis.__liveConfDesktopControl?.snapshot().origin ?? tunnelUrl, url),
  );
}

function notifyTelegramUrl(url, changed) {
  if (!telegramNotificationsConfigured()) return;
  if (lastTelegramNotificationUrl !== url) {
    sentTelegramNotifications.clear();
    lastTelegramNotificationUrl = url;
  }
  for (const chat of telegramSettings().chats) sendTelegramUrl(chat, url, changed);
}

function notifyTelegramTunnelStopped(url, recovering) {
  unavailableTunnelUrl = url;
  const strings = telegramStrings();
  const occurred = new Intl.DateTimeFormat(uiLocale, { dateStyle: "medium", timeStyle: "medium" }).format(new Date());
  const text = `${recovering ? strings.recoveringNotification : strings.stoppedNotification}\n\n${url}\n\n${strings.notificationTime}: ${occurred}`;
  for (const chat of telegramSettings().chats) {
    sentTelegramNotifications.delete(notificationKey(chat.id, url));
    const key = notificationKey(chat.id, `${url}\n${recovering ? "recovering" : "stopped"}`);
    sendTelegramNotification(chat, key, text, () => unavailableTunnelUrl === url);
  }
}

async function notifyTelegramAppStopped() {
  const url = tunnelUrl;
  const settings = telegramSettings();
  if (!url || settings.lastNotifiedUrl !== url || !telegramNotificationsConfigured()) return;
  const strings = telegramStrings();
  const occurred = new Intl.DateTimeFormat(uiLocale, { dateStyle: "medium", timeStyle: "medium" }).format(new Date());
  const text = `${strings.appStoppedNotification}\n\n${url}\n\n${strings.notificationTime}: ${occurred}`;
  await Promise.race([
    Promise.allSettled(settings.chats.map((chat) => sendTelegramMessage(chat.id, text))),
    delay(4_000),
  ]);
}

async function testTelegramChat(chatId) {
  const chat = telegramSettings().chats.find((item) => item.id === String(chatId));
  if (!chat) return telegramResult("genericError");
  try {
    await sendTelegramMessage(chat.id, telegramStrings().testNotification);
    return telegramResult();
  } catch {
    return telegramResult("genericError");
  }
}

function createDesktopSettings() {
  if (!app.isPackaged) return null;
  const userData = app.getPath("userData");

  desktopSettings ??= {};
  const createdPassword = desktopSettings.adminPassword ? null : randomBytes(9).toString("base64url");
  desktopSettings.adminPassword ||= createdPassword;
  desktopSettings.sessionSecret ||= randomBytes(32).toString("base64url");
  if (preferredShareOrigin) desktopSettings.preferredOrigin = preferredShareOrigin;
  writeDesktopSettings();

  process.env.ADMIN_PASSWORD ||= desktopSettings.adminPassword;
  process.env.SESSION_SECRET ||= desktopSettings.sessionSecret;
  process.env.DATABASE_PATH ||= path.join(userData, "meetings.db");
  return createdPassword;
}

function lanOrigin(address) {
  return desktopSettings?.localHttps
    ? `https://${address}:3443`
    : `http://${address}:${PORT}`;
}


function selectedLanOrigin() {
  const available = new Set(lanAddresses.map((item) => lanOrigin(item.address)));
  return available.has(preferredShareOrigin)
    ? preferredShareOrigin
    : lanOrigin(pickLanAddress(os.networkInterfaces()));
}

function selectShareOrigin(origin) {
  preferredShareOrigin = origin;
  shareOrigin = tunnelUrl || origin;
  if (desktopSettings) {
    desktopSettings.preferredOrigin = origin;
    writeDesktopSettings();
  }
  syncPublicOrigin();
  installApplicationMenu();
}

function isInternalAdminUrl(value) {
  try {
    const url = new URL(value);
    return url.origin === adminOrigin && (url.pathname === "/admin" || url.pathname.startsWith("/admin/"));
  } catch {
    return false;
  }
}

function openInBrowser(value) {
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") void shell.openExternal(url.href);
  } catch {
    // 잘못된 URL 은 열지 않는다.
  }
}

function cloudflaredPath() {
  if (app.isPackaged) return path.join(process.resourcesPath, "cloudflared.exe");
  const local = path.join(app.getAppPath(), ".tmp", "cloudflared");
  return existsSync(local) ? local : "cloudflared";
}

function cloudflaredConfigPath() {
  const configPath = path.join(app.getPath("userData"), "cloudflared-empty.yml");
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, "");
  return configPath;
}

function updateTunnelMenu() { globalThis.__liveConfSettingsChanged?.(); }

function syncPublicOrigin() {
  globalThis.__liveConfSettingsChanged?.();
  const value = JSON.stringify(globalThis.__liveConfDesktopControl?.snapshot().origin ?? shareOrigin);
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || !isInternalAdminUrl(window.webContents.getURL())) continue;
    void window.webContents.executeJavaScript(
      `localStorage.setItem("lct_public_origin", ${value}); window.dispatchEvent(new Event("lct-public-origin"));`,
    );
  }
}

function clearTunnelTimers() {
  if (tunnelHealthTimer) clearInterval(tunnelHealthTimer);
  if (tunnelRestartTimer) clearTimeout(tunnelRestartTimer);
  tunnelHealthTimer = null;
  tunnelRestartTimer = null;
  for (const timer of telegramNotificationTimers.values()) clearTimeout(timer);
  telegramNotificationTimers.clear();
}

function stopQuickTunnel(reason = "manual") {
  pendingTunnelUrl = null;
  if (reason === "manual") {
    telegramSettings().autoTunnel = false;
    writeDesktopSettings();
    clearTunnelTimers();
  }
  tunnelStopReason = reason;
  if (tunnelProcess) tunnelProcess.kill();
  else {
    tunnelState = "off";
    updateTunnelMenu();
  }
}

async function probePublicServer(origin) {
  try {
    const response = await fetch(`${origin}/api/health`, {
      cache: "no-store",
      signal: AbortSignal.timeout(8_000),
    });
    return response.ok && Boolean(parseHealth(await response.text()));
  } catch {
    return false;
  }
}

async function waitForPublicServer(origin) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (!tunnelProcess) return false;
    if (await probePublicServer(origin)) return true;
    await delay(1_000);
  }
  return false;
}

function scheduleTunnelRecovery() {
  if (quitApproved || !telegramSettings().autoTunnel || tunnelRestartTimer || tunnelStarting || tunnelProcess) return;
  tunnelState = "recovering";
  updateTunnelMenu();
  const wait = retryDelay(tunnelRetryAttempt);
  tunnelRetryAttempt += 1;
  tunnelRestartTimer = setTimeout(() => {
    tunnelRestartTimer = null;
    void startQuickTunnel({ interactive: false, recovering: true });
  }, wait);
}

function startTunnelHealthMonitor() {
  if (tunnelHealthTimer || !telegramSettings().autoTunnel) return;
  tunnelHealthTimer = setInterval(() => {
    if (!tunnelUrl || !tunnelProcess) return;
    void Promise.all([probeServer(), probePublicServer(tunnelUrl)]).then(([local, publicOkay]) => {
      if (publicOkay) {
        publicHealthFailures = 0;
        return;
      }
      publicHealthFailures += 1;
      if (shouldReplaceTunnel(local.state, publicHealthFailures)) stopQuickTunnel("recovery");
    });
  }, 30_000);
}

function setAutoTunnelEnabled(enabled, startNow = true) {
  const settings = telegramSettings();
  if (enabled && (!telegramToken() || settings.chats.length === 0)) return "recipientRequired";
  settings.autoTunnel = enabled;
  writeDesktopSettings();
  if (enabled) {
    if (tunnelUrl) {
      startTunnelHealthMonitor();
      notifyTelegramUrl(tunnelUrl, Boolean(settings.lastNotifiedUrl && settings.lastNotifiedUrl !== tunnelUrl));
    } else if (startNow) void probeServer().then(({ state }) => state === "ours" && startQuickTunnel({ interactive: false }));
  } else clearTunnelTimers();
  installApplicationMenu();
  telegramStateChanged();
  return null;
}

async function requestQuit() {
  if (quitPromptOpen || quitApproved) return;
  quitPromptOpen = true;

  try {
    const { state, openMeetings } = await probeServer();
    if (state === "ours" && openMeetings > 0) {
      const options = {
        type: "warning",
        title: "진행 중인 세션",
        message: `진행 중인 세션이 ${openMeetings}개 있습니다. 종료하시겠습니까?`,
        detail: "종료 전에 참석자 안내와 세션 종료 여부를 확인해 주세요.",
        buttons: ["취소", "종료"],
        defaultId: 0,
        cancelId: 0,
      };
      const result =
        mainWindow && !mainWindow.isDestroyed()
          ? await dialog.showMessageBox(mainWindow, options)
          : await dialog.showMessageBox(options);
      if (result.response !== 1) return;
    }

    await notifyTelegramAppStopped();
    quitApproved = true;
    app.quit();
  } finally {
    quitPromptOpen = false;
  }
}

async function startQuickTunnel({ interactive = true, recovering = false } = {}) {
  if (tunnelProcess || tunnelStarting) return;
  tunnelStarting = true;
  tunnelInteractive = interactive;
  tunnelState = recovering ? "recovering" : "connecting";
  updateTunnelMenu();
  let recentLog = "";
  let candidateUrl = null;
  tunnelStartError = "tunnelExited";
  const strings = telegramStrings();

  try {
    const binary = cloudflaredPath();
    if (app.isPackaged && !existsSync(binary)) {
      tunnelStartError = "tunnelBinaryMissing";
      throw new Error(strings.tunnelBinaryMissing);
    }

    candidateUrl = await new Promise((resolve, reject) => {
      const child = spawn(
        binary,
        [
          "tunnel",
          "--config",
          cloudflaredConfigPath(),
          "--no-autoupdate",
          "--url",
          LOOPBACK_ORIGIN,
          "--protocol",
          "http2",
        ],
        { windowsHide: true },
      );
      tunnelProcess = child;
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        tunnelStartError = "tunnelUrlTimeout";
        child.kill();
        reject(new Error(strings.tunnelUrlTimeout));
      }, 30_000);

      const read = (chunk) => {
        const text = chunk.toString();
        recentLog = `${recentLog}${text}`.slice(-3000);
        const found = extractQuickTunnelUrl(recentLog);
        if (!found || settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(found);
      };
      child.stdout.on("data", read);
      child.stderr.on("data", read);
      child.on("error", (error) => {
        if (error.code === "ENOENT") tunnelStartError = "tunnelBinaryMissing";
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (tunnelProcess === child) tunnelProcess = null;
        pendingTunnelUrl = null;
        reject(error);
      });
      child.on("exit", (code) => {
        if (tunnelProcess !== child) return;
        pendingTunnelUrl = null;
        const endedTunnelUrl = tunnelUrl || candidateUrl;
        const activeTunnelUrl = tunnelUrl;
        const reason = tunnelStopReason;
        const unexpected = settled && !reason && Boolean(endedTunnelUrl);
        const recoveringTunnel = reason === "recovery" || (unexpected && telegramSettings().autoTunnel);
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error(`${strings.tunnelExited}. (${code ?? "?"})`));
        }
        tunnelProcess = null;
        tunnelUrl = null;
        tunnelState = recoveringTunnel ? "recovering" : "off";
        if (shareOrigin === endedTunnelUrl) shareOrigin = selectedLanOrigin();
        tunnelStopReason = null;
        publicHealthFailures = 0;
        if (tunnelHealthTimer) clearInterval(tunnelHealthTimer);
        tunnelHealthTimer = null;
        syncPublicOrigin();
        installApplicationMenu();
        if (shouldNotifyTunnelStopped(reason, activeTunnelUrl, telegramSettings().lastNotifiedUrl)) {
          notifyTelegramTunnelStopped(activeTunnelUrl, recoveringTunnel);
        }
        if (recoveringTunnel) scheduleTunnelRecovery();
        else if (unexpected && tunnelInteractive && !tunnelStarting) {
          dialog.showErrorBox(strings.tunnelStart, strings.genericError);
        }
      });
    });

    // Permit only this candidate Host while probing; do not publish it before verification.
    pendingTunnelUrl = candidateUrl;
    tunnelStartError = "tunnelHealthFailed";
    if (!await waitForPublicServer(candidateUrl) || !tunnelProcess || pendingTunnelUrl !== candidateUrl) throw new Error(strings.tunnelHealthFailed);
    tunnelUrl = candidateUrl;
    pendingTunnelUrl = null;
    tunnelStartError = null;
    unavailableTunnelUrl = null;
    shareOrigin = candidateUrl;
    tunnelState = "connected";
    tunnelRetryAttempt = 0;
    publicHealthFailures = 0;
    syncPublicOrigin();
    installApplicationMenu();
    startTunnelHealthMonitor();
    const settings = telegramSettings();
    const changed = Boolean(settings.lastNotifiedUrl && settings.lastNotifiedUrl !== tunnelUrl);
    if (telegramNotificationsConfigured()) settings.lastNotifiedUrl = tunnelUrl;
    writeDesktopSettings();
    notifyTelegramUrl(tunnelUrl, changed);
    if (interactive) {
      const result = await dialog.showMessageBox(mainWindow, {
        type: "info",
        title: strings.tunnelStart,
        message: strings.tunnelStatusConnected,
        detail: `${tunnelUrl}\n\n${strings.quickTunnelNotice}`,
        buttons: [strings.tunnelCopy, strings.tunnelOpen, strings.close],
        defaultId: 0,
      });
      if (result.response === 0) clipboard.writeText(tunnelUrl);
      if (result.response === 1) openInBrowser(tunnelUrl);
    }
  } catch (error) {
    if (tunnelProcess) {
      tunnelStopReason = telegramSettings().autoTunnel ? "recovery" : "failed";
      tunnelProcess.kill();
    }
    tunnelUrl = null;
    tunnelState = telegramSettings().autoTunnel ? "recovering" : "off";
    const message = error instanceof Error ? error.message : String(error);
    if (interactive) {
      dialog.showErrorBox(strings.tunnelStart, `${message}${recentLog ? `\n\n${recentLog}` : ""}`);
    } else scheduleTunnelRecovery();
  } finally {
    pendingTunnelUrl = null;
    tunnelStarting = false;
    updateTunnelMenu();
    if (tunnelState === "recovering") scheduleTunnelRecovery();
  }
}


function installApplicationMenu() {
  // OS-standard macOS shortcuts remain; Windows/Linux have no Alt-revivable menu.
  Menu.setApplicationMenu(process.platform === "darwin"
    ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" }])
    : null);
  globalThis.__liveConfSettingsChanged?.();
}

function applyNavigationPolicy(contents) {
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11") {
      const window = BrowserWindow.fromWebContents(contents);
      if (window) { event.preventDefault(); window.setFullScreen(!window.isFullScreen()); }
    } else if (input.key === "F5" || ((input.control || input.meta) && input.key.toLowerCase() === "r")) {
      event.preventDefault();
      if (input.shift) contents.reloadIgnoringCache(); else contents.reload();
    }
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isInternalAdminUrl(url)) {
      return { action: "allow", overrideBrowserWindowOptions: { webPreferences: secureWebPreferences } };
    }
    openInBrowser(url);
    return { action: "deny" };
  });

  contents.on("will-navigate", (event, url) => {
    if (isInternalAdminUrl(url)) return;
    event.preventDefault();
    openInBrowser(url);
  });
}

function observeUiLanguage(window) {
  if (observingUiLocale) return;
  observingUiLocale = true;
  const cookies = window.webContents.session.cookies;
  const applyLocale = (value) => {
    const next = value || "ko";
    if (uiLocale === next) return;
    uiLocale = next;
    installApplicationMenu();
  };
  cookies.on("changed", (_event, cookie, _cause, removed) => {
    if (cookie.name === ADMIN_LANG_COOKIE) applyLocale(removed ? "ko" : cookie.value);
  });
  void cookies.get({ url: adminOrigin, name: ADMIN_LANG_COOKIE })
    .then(([cookie]) => applyLocale(cookie?.value))
    .catch(() => {});
}

function createWindow(loadAdmin = true) {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    show: !loadAdmin,
    title: "Live Conference Translation",
    webPreferences: secureWebPreferences,
  });
  observeUiLanguage(window);
  if (loadAdmin) window.once("ready-to-show", () => window.show());
  window.webContents.on("did-finish-load", () => {
    if (isInternalAdminUrl(window.webContents.getURL())) syncPublicOrigin();
  });
  window.on("close", (event) => {
    if (quitApproved) return;
    event.preventDefault();
    void requestQuit();
  });
  if (loadAdmin) void window.loadURL(`${adminOrigin}/admin`);
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  mainWindow = window;
}

async function start() {
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(permission === "media" && microphoneAllowed(details.requestingUrl, details.mediaTypes, contents.getURL(), adminOrigin));
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission, origin, details) => {
    return permission === "media" && details.mediaType === "audio" &&
      microphoneAllowed(details.requestingUrl || origin, ["audio"], contents?.getURL(), adminOrigin);
  });
  const appRoot = app.getAppPath();
  process.env.CLOUDFLARED_PATH = cloudflaredPath();
  globalThis.__liveConfTranslationAppRoot = appRoot;
  globalThis.__liveConfAllowedOrigins = desktopAllowedOrigins;
  process.env.TRUSTED_PROXY_IPS = "127.0.0.1,::1";
  process.env.NODE_ENV = "production";
  process.env.HOSTNAME = "0.0.0.0";
  process.env.PORT = String(PORT);
  loadDesktopSettings();
  lanAddresses = listLanAddresses(os.networkInterfaces());
  shareOrigin = selectedLanOrigin();

  // 서버 준비와 첫 렌더링을 기다리는 동안에도 앱이 실행됐다는 것을 바로 보여 준다.
  installApplicationMenu();
  createWindow(false);

  let generatedPassword = null;
  let localHttpsError = null;
  if (app.isPackaged) {
    generatedPassword = createDesktopSettings();
    try {
      await ensureLocalCertificate({
        app,
        settings: desktopSettings,
        save: writeDesktopSettings,
        addresses: lanAddresses.map((item) => item.address),
      });
      shareOrigin = selectedLanOrigin();
      installApplicationMenu();
    } catch (error) {
      localHttpsError = error instanceof Error ? error.message : String(error);
      console.warn("[local-https] 인증서를 만들지 못해 HTTP로 시작합니다", localHttpsError);
      shareOrigin = selectedLanOrigin();
      installApplicationMenu();
    }
  }

  const { state } = await probeServer();
  if (state === "occupied") throw new Error(`포트 ${PORT}을 다른 프로그램이 사용하고 있습니다.`);
  if (state === "free") {
    globalThis.__liveConfDesktopControl = { snapshot: desktopControlState, run: runDesktopControl,
      notifyOrigin: (origin) => notifyTelegramUrl(origin, true) };
    require(path.join(appRoot, "dist", "server.cjs"));
    await waitForServer();
  }

  if (!mainWindow || mainWindow.isDestroyed()) return;
  await mainWindow.loadURL(`${adminOrigin}/admin`);
  void telegramBot.start();
  if (telegramSettings().autoTunnel) void startQuickTunnel({ interactive: false });

  if (localHttpsError) {
    const text = localAiStrings(uiLocale);
    await dialog.showMessageBox(mainWindow, {
      type: "warning",
      title: text.httpsFailed,
      message: text.httpsFailed,
      detail: `${text.httpsFailedDetail}\n\n${localHttpsError}`,
      buttons: ["OK"],
    });
  }

  if (generatedPassword) {
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "관리자 비밀번호",
      message: "처음 실행용 관리자 비밀번호가 생성되었습니다.",
      detail: generatedPassword,
      buttons: ["비밀번호 복사", "확인"],
      defaultId: 0,
    });
    if (result.response === 0) clipboard.writeText(generatedPassword);

  }
}

const localAiInstallIndex = process.argv.indexOf("--install-local-ai");
if (localAiInstallIndex >= 0) {
  const configFile = process.argv[localAiInstallIndex + 1];
  const errorFile = process.argv[localAiInstallIndex + 2];
  app.whenReady()
    .then(() => installLocalAi(configFile))
    .then(() => app.exit(0))
    .catch((error) => {
      if (errorFile) writeFileSync(errorFile, error instanceof Error ? error.message : String(error));
      app.exit(1);
    });
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) createWindow();
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });
  app.on("web-contents-created", (_event, contents) => applyNavigationPolicy(contents));
  app.whenReady().then(start).catch((error) => {
    dialog.showErrorBox("실행 실패", error instanceof Error ? error.message : String(error));
    app.quit();
  });
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
  app.on("before-quit", (event) => {
    if (!quitApproved) {
      event.preventDefault();
      void requestQuit();
      return;
    }
    clearTunnelTimers();
    telegramBot.stop();
    stopQuickTunnel("quit");
  });
  app.on("window-all-closed", () => app.quit());
}
