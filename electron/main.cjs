/* eslint-disable @typescript-eslint/no-require-imports */
const { randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { z } = require("zod");

const { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, safeStorage, shell } = require("electron");

const {
  extractQuickTunnelUrl,
  listLanAddresses,
  parseHealth,
  pickLanAddress,
} = require("./network.cjs");
const { applyLocalAiEnvironment, ensureLocalCertificate, installLocalAi, installedLocalAi, stringsFor: localAiStrings } = require("./local-ai.cjs");
const {
  notificationKey,
  pairingChat,
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
let tunnelInteractive = false;
let tunnelStopReason = null;
let tunnelUrl = null;
let tunnelState = "off";
let tunnelHealthTimer = null;
let tunnelRestartTimer = null;
let tunnelRetryAttempt = 0;
let publicHealthFailures = 0;
let telegramWindow = null;
let telegramPairing = false;
let lastTelegramNotificationUrl = null;
let unavailableTunnelUrl = null;
const sentTelegramNotifications = new Set();
const telegramNotificationTimers = new Map();
const telegramTokenSchema = z.string().trim().regex(/^\d{6,20}:[A-Za-z0-9_-]{20,}$/);
const telegramChatIdSchema = z.string().regex(/^-?\d+$/);
const telegramCopySchema = z.string().max(100);
const telegramPairModeSchema = z.enum(["private", "group"]);
let quitApproved = false;
let quitPromptOpen = false;

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
    strings: stringsForLocale(uiLocale),
    bot: settings.botId && settings.botUsername
      ? { id: settings.botId, name: settings.botName || settings.botUsername, username: settings.botUsername }
      : null,
    chats: settings.chats,
    autoTunnel: Boolean(settings.autoTunnel),
  };
}

function telegramResult(error = null) {
  return error ? { ok: false, error } : { ok: true, state: telegramSetupState() };
}

async function telegramRequest(token, method, payload, timeout = 20_000) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(timeout),
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
    return telegramResult();
  } catch {
    return telegramResult("invalidToken");
  }
}

async function pairTelegramChat(mode) {
  const token = telegramToken();
  const settings = telegramSettings();
  if (!token || !settings.botUsername) return telegramResult("botRequired");
  if (telegramPairing) return telegramResult("genericError");
  telegramPairing = true;
  try {
    const webhook = await telegramRequest(token, "getWebhookInfo", {});
    if (webhook?.url) return telegramResult("webhookConflict");
    const initial = await telegramRequest(token, "getUpdates", {
      offset: -1,
      limit: 1,
      timeout: 0,
      allowed_updates: ["message"],
    });
    let offset = initial.length ? initial.at(-1).update_id + 1 : 0;
    const nonce = randomBytes(18).toString("base64url");
    const parameter = mode === "private" ? "start" : "startgroup";
    openInBrowser(`https://t.me/${settings.botUsername}?${parameter}=${nonce}`);
    const deadline = Date.now() + 120_000;
    while (Date.now() < deadline) {
      const updates = await telegramRequest(token, "getUpdates", {
        offset,
        limit: 20,
        timeout: 15,
        allowed_updates: ["message"],
      }, 20_000);
      for (const update of updates) {
        offset = Math.max(offset, update.update_id + 1);
        const chat = pairingChat(update, nonce, mode);
        if (!chat) continue;
        settings.chats = [...settings.chats.filter((item) => item.id !== chat.id), chat];
        writeDesktopSettings();
        return telegramResult();
      }
    }
    return telegramResult("pairingTimeout");
  } catch {
    return telegramResult("genericError");
  } finally {
    telegramPairing = false;
  }
}

async function sendTelegramMessage(chatId, text) {
  const token = telegramToken();
  if (!token) throw new Error("telegram_token_missing");
  return telegramRequest(token, "sendMessage", { chat_id: chatId, text, disable_web_page_preview: true });
}

function telegramNotificationText(url, changed = false) {
  const strings = stringsForLocale(uiLocale);
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
    () => shouldSendTelegramUrl(Boolean(telegramToken()), telegramSettings().chats.length, tunnelUrl, url),
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
  const strings = stringsForLocale(uiLocale);
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
  const strings = stringsForLocale(uiLocale);
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
    await sendTelegramMessage(chat.id, stringsForLocale(uiLocale).testNotification);
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

function caDownloadUrl() {
  const address = pickLanAddress(os.networkInterfaces());
  return `http://${address}:${PORT}/local-ca.cer`;
}

function selectedLanOrigin() {
  const available = new Set(lanAddresses.map((item) => lanOrigin(item.address)));
  return available.has(preferredShareOrigin)
    ? preferredShareOrigin
    : lanOrigin(pickLanAddress(os.networkInterfaces()));
}

function selectShareOrigin(origin) {
  preferredShareOrigin = origin;
  shareOrigin = origin;
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

function updateTunnelMenu() {
  const menu = Menu.getApplicationMenu();
  const strings = stringsForLocale(uiLocale);
  const connected = Boolean(tunnelProcess && tunnelUrl);
  const start = menu?.getMenuItemById("tunnel-start");
  const status = menu?.getMenuItemById("tunnel-status");
  const copy = menu?.getMenuItemById("tunnel-copy");
  const open = menu?.getMenuItemById("tunnel-open");
  const stop = menu?.getMenuItemById("tunnel-stop");
  if (start) start.enabled = !tunnelProcess && !tunnelStarting;
  if (status) status.label = tunnelState === "recovering"
    ? strings.tunnelStatusRecovering
    : tunnelStarting
      ? strings.tunnelStatusConnecting
      : connected
        ? strings.tunnelStatusConnected
        : strings.tunnelStatusOff;
  if (copy) copy.enabled = connected;
  if (open) open.enabled = connected;
  if (stop) stop.enabled = Boolean(tunnelProcess);
}

function syncPublicOrigin() {
  const value = JSON.stringify(shareOrigin);
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

function setAutoTunnelEnabled(enabled) {
  const settings = telegramSettings();
  if (enabled && (!telegramToken() || settings.chats.length === 0)) return "recipientRequired";
  settings.autoTunnel = enabled;
  writeDesktopSettings();
  if (enabled) {
    if (tunnelUrl) {
      startTunnelHealthMonitor();
      notifyTelegramUrl(tunnelUrl, Boolean(settings.lastNotifiedUrl && settings.lastNotifiedUrl !== tunnelUrl));
    } else void probeServer().then(({ state }) => state === "ours" && startQuickTunnel({ interactive: false }));
  } else clearTunnelTimers();
  installApplicationMenu();
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
  const strings = stringsForLocale(uiLocale);

  try {
    const binary = cloudflaredPath();
    if (app.isPackaged && !existsSync(binary)) throw new Error(strings.tunnelBinaryMissing);

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
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
      child.on("exit", (code) => {
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

    if (!await waitForPublicServer(candidateUrl)) throw new Error(strings.tunnelHealthFailed);
    tunnelUrl = candidateUrl;
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
    tunnelStarting = false;
    updateTunnelMenu();
    if (tunnelState === "recovering") scheduleTunnelRecovery();
  }
}

function isTelegramSetupUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "file:" && path.basename(decodeURIComponent(url.pathname)) === "telegram-setup.html";
  } catch {
    return false;
  }
}

function openTelegramSetup() {
  if (telegramWindow && !telegramWindow.isDestroyed()) {
    telegramWindow.focus();
    return;
  }
  telegramWindow = new BrowserWindow({
    width: 760,
    height: 820,
    minWidth: 560,
    minHeight: 620,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    modal: Boolean(mainWindow && !mainWindow.isDestroyed()),
    show: false,
    title: stringsForLocale(uiLocale).windowTitle,
    webPreferences: {
      ...secureWebPreferences,
      preload: path.join(__dirname, "telegram-preload.cjs"),
    },
  });
  telegramWindow.once("ready-to-show", () => telegramWindow?.show());
  telegramWindow.on("closed", () => {
    telegramWindow = null;
  });
  void telegramWindow.loadFile(path.join(__dirname, "telegram-setup.html"));
}

function telegramIpcAllowed(event) {
  return Boolean(telegramWindow && !telegramWindow.isDestroyed() && event.sender === telegramWindow.webContents);
}

function registerTelegramIpc() {
  ipcMain.handle("telegram:get-state", (event) => telegramIpcAllowed(event) ? telegramResult() : telegramResult("genericError"));
  ipcMain.handle("telegram:open-bot-father", (event) => {
    if (!telegramIpcAllowed(event)) return telegramResult("genericError");
    openInBrowser("https://t.me/BotFather");
    return telegramResult();
  });
  ipcMain.handle("telegram:copy", (event, value) => {
    const parsed = telegramCopySchema.safeParse(value);
    if (!telegramIpcAllowed(event) || !parsed.success) return telegramResult("genericError");
    clipboard.writeText(parsed.data);
    return telegramResult();
  });
  ipcMain.handle("telegram:verify", (event, token) => {
    const parsed = telegramTokenSchema.safeParse(token);
    if (!telegramIpcAllowed(event) || !parsed.success) return telegramResult("invalidToken");
    return verifyTelegramBot(parsed.data);
  });
  ipcMain.handle("telegram:pair", (event, mode) => {
    const parsed = telegramPairModeSchema.safeParse(mode);
    if (!telegramIpcAllowed(event) || !parsed.success) return telegramResult("genericError");
    return pairTelegramChat(parsed.data);
  });
  ipcMain.handle("telegram:test-chat", (event, chatId) => {
    const parsed = telegramChatIdSchema.safeParse(chatId);
    if (!telegramIpcAllowed(event) || !parsed.success) return telegramResult("genericError");
    return testTelegramChat(parsed.data);
  });
  ipcMain.handle("telegram:remove-chat", (event, chatId) => {
    const parsed = telegramChatIdSchema.safeParse(chatId);
    if (!telegramIpcAllowed(event) || !parsed.success) return telegramResult("genericError");
    const settings = telegramSettings();
    settings.chats = settings.chats.filter((chat) => chat.id !== parsed.data);
    if (settings.chats.length === 0) {
      settings.autoTunnel = false;
      clearTunnelTimers();
    }
    writeDesktopSettings();
    return telegramResult();
  });
  ipcMain.handle("telegram:set-auto-tunnel", (event, enabled) => {
    const parsed = z.boolean().safeParse(enabled);
    if (!telegramIpcAllowed(event) || !parsed.success) return telegramResult("genericError");
    return telegramResult(setAutoTunnelEnabled(parsed.data));
  });
  ipcMain.handle("telegram:close", (event) => {
    if (!telegramIpcAllowed(event)) return telegramResult("genericError");
    telegramWindow.close();
    return telegramResult();
  });
}

function installApplicationMenu() {
  const localText = localAiStrings(uiLocale);
  const telegramText = stringsForLocale(uiLocale);
  const addressItems = lanAddresses.length
    ? lanAddresses.map((item) => {
        const origin = lanOrigin(item.address);
        return {
          label: `${item.virtual ? "VPN/가상" : "실제"} · ${item.name} · ${item.address}`,
          type: "radio",
          checked: shareOrigin === origin,
          click: () => selectShareOrigin(origin),
        };
      })
    : [
        {
          label: `로컬 · 127.0.0.1`,
          type: "radio",
          checked: shareOrigin === LOOPBACK_ORIGIN,
          click: () => selectShareOrigin(LOOPBACK_ORIGIN),
        },
      ];

  if (tunnelUrl) {
    addressItems.push({
      label: `공개 · Cloudflare · ${tunnelUrl}`,
      type: "radio",
      checked: shareOrigin === tunnelUrl,
      click: () => {
        shareOrigin = tunnelUrl;
        syncPublicOrigin();
        installApplicationMenu();
      },
    });
  }

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "설정",
        submenu: [
          {
            label: telegramText.appGuide,
            click: () => {
              if (!mainWindow || mainWindow.isDestroyed()) return;
              void mainWindow.webContents.executeJavaScript(
                'sessionStorage.setItem("live-conf-translation:app-guide", "admin"); location.assign("/admin")',
              );
              mainWindow.show();
              mainWindow.focus();
            },
          },
          { type: "separator" },
          { label: "기본 공유 주소", submenu: addressItems },
          { label: localText.caDownload, enabled: Boolean(desktopSettings?.localHttps), click: () => openInBrowser(caDownloadUrl()) },
          { type: "separator" },
          { label: telegramText.tunnelTelegram, click: openTelegramSetup },
          {
            type: "checkbox",
            label: telegramText.autoLabel,
            checked: Boolean(telegramSettings().autoTunnel),
            click: (item) => {
              const error = setAutoTunnelEnabled(item.checked);
              if (!error) return;
              item.checked = false;
              dialog.showMessageBox({ type: "warning", title: telegramText.autoLabel, message: telegramText[error] });
            },
          },
          { id: "tunnel-status", label: telegramText.tunnelStatusOff, enabled: false },
          { type: "separator" },
          { id: "tunnel-start", label: telegramText.tunnelStart, click: () => void startQuickTunnel() },
          {
            id: "tunnel-copy",
            label: telegramText.tunnelCopy,
            enabled: false,
            click: () => tunnelUrl && clipboard.writeText(tunnelUrl),
          },
          {
            id: "tunnel-open",
            label: telegramText.tunnelOpen,
            enabled: false,
            click: () => tunnelUrl && openInBrowser(tunnelUrl),
          },
          { id: "tunnel-stop", label: telegramText.tunnelStop, enabled: false, click: () => stopQuickTunnel("manual") },
        ],
      },
      { role: "editMenu" },
      { role: "viewMenu" },
      { role: "windowMenu" },
    ]),
  );
  updateTunnelMenu();
}

function applyNavigationPolicy(contents) {
  contents.setWindowOpenHandler(({ url }) => {
    if (isInternalAdminUrl(url)) {
      return { action: "allow", overrideBrowserWindowOptions: { webPreferences: secureWebPreferences } };
    }
    openInBrowser(url);
    return { action: "deny" };
  });

  contents.on("will-navigate", (event, url) => {
    if (isInternalAdminUrl(url) || isTelegramSetupUrl(url)) return;
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
  const appRoot = app.getAppPath();
  globalThis.__liveConfTranslationAppRoot = appRoot;
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
    require(path.join(appRoot, "dist", "server.cjs"));
    await waitForServer();
  }

  if (!mainWindow || mainWindow.isDestroyed()) return;
  await mainWindow.loadURL(`${adminOrigin}/admin`);
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
  registerTelegramIpc();
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
    stopQuickTunnel("quit");
  });
  app.on("window-all-closed", () => app.quit());
}
