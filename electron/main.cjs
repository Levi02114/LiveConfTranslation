/* eslint-disable @typescript-eslint/no-require-imports */
const { randomBytes } = require("node:crypto");
const { spawn } = require("node:child_process");
const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const { app, BrowserWindow, clipboard, dialog, Menu, shell } = require("electron");

const {
  extractQuickTunnelUrl,
  listLanAddresses,
  parseHealth,
  pickLanAddress,
  toLoopbackBrowserUrl,
} = require("./network.cjs");

const PORT = 3000;
const LOOPBACK_ORIGIN = `http://127.0.0.1:${PORT}`;
const secureWebPreferences = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
};

const adminOrigin = LOOPBACK_ORIGIN;
let mainWindow = null;
let desktopSettings = null;
let desktopSettingsPath = null;
let lanAddresses = [];
let preferredShareOrigin = null;
let shareOrigin = LOOPBACK_ORIGIN;
let tunnelProcess = null;
let tunnelStarting = false;
let tunnelStopping = false;
let tunnelUrl = null;
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
  if (!app.isPackaged) return;
  const userData = app.getPath("userData");
  desktopSettingsPath = path.join(userData, "desktop-settings.json");
  mkdirSync(userData, { recursive: true });
  if (!existsSync(desktopSettingsPath)) return;
  desktopSettings = JSON.parse(readFileSync(desktopSettingsPath, "utf8"));
  preferredShareOrigin = desktopSettings.preferredOrigin ?? null;
}

function writeDesktopSettings() {
  if (!desktopSettingsPath || !desktopSettings) return;
  writeFileSync(desktopSettingsPath, `${JSON.stringify(desktopSettings, null, 2)}\n`, { mode: 0o600 });
}

function createDesktopSettings() {
  if (!app.isPackaged) return null;
  const userData = app.getPath("userData");

  const created = !desktopSettings;
  if (created) {
    desktopSettings = {
      adminPassword: randomBytes(9).toString("base64url"),
      sessionSecret: randomBytes(32).toString("base64url"),
      ...(preferredShareOrigin ? { preferredOrigin: preferredShareOrigin } : {}),
    };
    writeDesktopSettings();
  }

  process.env.ADMIN_PASSWORD ||= desktopSettings.adminPassword;
  process.env.SESSION_SECRET ||= desktopSettings.sessionSecret;
  process.env.DATABASE_PATH ||= path.join(userData, "meetings.db");
  return created ? desktopSettings.adminPassword : null;
}

function lanOrigin(address) {
  return `http://${address}:${PORT}`;
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
    if (url.protocol === "http:" || url.protocol === "https:") {
      const target = toLoopbackBrowserUrl(
        url.href,
        lanAddresses.map((item) => item.address),
        PORT,
      );
      void shell.openExternal(target);
    }
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
  const connected = Boolean(tunnelProcess && tunnelUrl);
  const start = menu?.getMenuItemById("tunnel-start");
  const status = menu?.getMenuItemById("tunnel-status");
  const copy = menu?.getMenuItemById("tunnel-copy");
  const open = menu?.getMenuItemById("tunnel-open");
  const stop = menu?.getMenuItemById("tunnel-stop");
  if (start) start.enabled = !tunnelProcess && !tunnelStarting;
  if (status) status.label = tunnelStarting ? "상태: 연결 중" : connected ? "상태: 연결됨" : "상태: 꺼짐";
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

function stopQuickTunnel() {
  if (!tunnelProcess) return;
  tunnelStopping = true;
  tunnelProcess.kill();
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

    quitApproved = true;
    app.quit();
  } finally {
    quitPromptOpen = false;
  }
}

async function startQuickTunnel() {
  if (tunnelProcess || tunnelStarting) return;
  tunnelStarting = true;
  updateTunnelMenu();
  let recentLog = "";

  try {
    const binary = cloudflaredPath();
    if (app.isPackaged && !existsSync(binary)) throw new Error("설치 파일에서 cloudflared.exe를 찾지 못했습니다.");

    tunnelUrl = await new Promise((resolve, reject) => {
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
        reject(new Error("Cloudflare 공개 URL을 30초 안에 받지 못했습니다."));
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
        const endedTunnelUrl = tunnelUrl;
        const unexpected = settled && !tunnelStopping && Boolean(tunnelUrl);
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(new Error(`cloudflared가 종료되었습니다. (${code ?? "알 수 없음"})`));
        }
        tunnelProcess = null;
        tunnelUrl = null;
        if (shareOrigin === endedTunnelUrl) shareOrigin = selectedLanOrigin();
        tunnelStopping = false;
        syncPublicOrigin();
        installApplicationMenu();
        if (unexpected) dialog.showErrorBox("Cloudflare Tunnel 종료", "공개 터널 연결이 예기치 않게 종료되었습니다.");
      });
    });

    shareOrigin = tunnelUrl;
    syncPublicOrigin();
    installApplicationMenu();
    const result = await dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "Cloudflare 공개 URL",
      message: "임시 공개 URL이 준비되었습니다.",
      detail: `${tunnelUrl}\n\nQuick Tunnel은 테스트용이며 앱을 종료하면 주소도 사라집니다.`,
      buttons: ["URL 복사", "브라우저에서 열기", "확인"],
      defaultId: 0,
    });
    if (result.response === 0) clipboard.writeText(tunnelUrl);
    if (result.response === 1) openInBrowser(tunnelUrl);
  } catch (error) {
    tunnelProcess = null;
    tunnelUrl = null;
    const message = error instanceof Error ? error.message : String(error);
    dialog.showErrorBox("Cloudflare Tunnel 실패", `${message}${recentLog ? `\n\n${recentLog}` : ""}`);
  } finally {
    tunnelStarting = false;
    updateTunnelMenu();
  }
}

function installApplicationMenu() {
  const addressItems = lanAddresses.length
    ? lanAddresses.map((item) => {
        const origin = lanOrigin(item.address);
        return {
          label: `${item.virtual ? "가상" : "실제"} · ${item.name} · ${item.address}`,
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

  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "설정",
        submenu: [
          { label: "기본 공유 주소", submenu: addressItems },
          { type: "separator" },
          { id: "tunnel-status", label: "상태: 꺼짐", enabled: false },
          { type: "separator" },
          { id: "tunnel-start", label: "Cloudflare 공개 URL 만들기", click: () => void startQuickTunnel() },
          {
            id: "tunnel-copy",
            label: "공개 URL 복사",
            enabled: false,
            click: () => tunnelUrl && clipboard.writeText(tunnelUrl),
          },
          {
            id: "tunnel-open",
            label: "공개 URL 브라우저에서 열기",
            enabled: false,
            click: () => tunnelUrl && openInBrowser(tunnelUrl),
          },
          { id: "tunnel-stop", label: "공개 터널 종료", enabled: false, click: stopQuickTunnel },
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
    if (isInternalAdminUrl(url)) return;
    event.preventDefault();
    openInBrowser(url);
  });
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

  const { state } = await probeServer();
  if (state === "occupied") throw new Error(`포트 ${PORT}을 다른 프로그램이 사용하고 있습니다.`);
  let generatedPassword = null;
  if (state === "free") {
    generatedPassword = createDesktopSettings();
    require(path.join(appRoot, "dist", "server.cjs"));
    await waitForServer();
  }

  if (!mainWindow || mainWindow.isDestroyed()) return;
  await mainWindow.loadURL(`${adminOrigin}/admin`);

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

if (!app.requestSingleInstanceLock()) {
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
    stopQuickTunnel();
  });
  app.on("window-all-closed", () => app.quit());
}
