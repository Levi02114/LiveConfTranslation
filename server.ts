/**
 * 커스텀 Node 서버.
 *
 * Next.js 라우트 핸들러만으로는 WebSocket 업그레이드를 받을 수 없다. 입력 페이지의
 * 다중 속기사 동기화가 양방향이라 WebSocket 이 필요하고, 그래서 HTTP 서버를 직접
 * 띄워 Next 를 그 위에 얹는다. 자체 호스팅 전용이라 제약이 없다.
 *
 * 실행: `npm run dev` / `npm start` (둘 다 이 파일을 tsx 로 띄운다)
 *
 * ─ 모듈 인스턴스에 대하여 ─
 * Next 가 번들한 라우트 핸들러와 이 파일은 같은 `src/lib/*` 를 각각 따로 평가한다.
 * 그래서 허브 상태는 `globalThis` 에 둔다(`src/lib/realtime/hub.ts`). 같은 프로세스라
 * 양쪽이 같은 객체를 본다.
 */

import { createServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import type { IncomingMessage, Server as HttpServer } from "node:http";
import type { Server as HttpsServer } from "node:https";
import { createHash, randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join as joinPath } from "node:path";
import { initializeDiagnostics } from "./electron/diagnostics.cjs";
import { log, errorFields, safeRoute, withContext, flushDiagnostics } from "@/lib/diagnostics";

import next from "next";
import { WebSocket as WsSocket, WebSocketServer, type RawData, type WebSocket } from "ws";
import { z } from "zod";

import { isAdminFromCookieHeader } from "@/lib/auth-core";
import { desktopOperations, sessionConnections } from "@/lib/desktop-operations";
import { desktopTransportAllowed } from "@/lib/desktop-control";
import { startServerControl } from "@/lib/server-control";
import { startNamedTunnelControl, tunnelProbeAnswer } from "@/lib/named-tunnel";
import { notifyAppSettings, subscribeAppSettings, type VoiceSettings } from "@/lib/voice-settings";
import { validateRequest, limitRequestBody, requestRequiresOrigin } from "@/lib/http-security";
import { rateLimit } from "@/lib/security-limits";
import { activeTranscriptions } from "@/lib/realtime/transcription-registry";
import type { InternalTranscriptionRequest } from "@/lib/realtime/internal-transcription";
import { matchDetectedLanguage } from "@/lib/detected-language";
import {
  localHttpsCaPath,
  localHttpsPfxPassword,
  localHttpsPfxPath,
  localHttpsPort,
  openaiRealtimeTranscribeUrl,
  serverEnvironment,
  databasePath,
  diagnosticsDirectory,
} from "@/lib/env";
import {
  hasCleanSinhalaScript,
  hasScriptEvidence,
  needsSinhalaRescue,
  scriptLanguageOf,
} from "@/lib/script-language";
import { ensureLocalTranscriptionRuntime, localTranscriptionConfigured } from "@/lib/local-runtime";
import { transcribeLocalPcm } from "@/lib/local-transcription";
import { transcribeGooglePcm } from "@/lib/google-transcription";
import type { LanguageCode } from "@/lib/languages";
import {
  broadcastPresence,
  claimInputName,
  type Connection,
  join,
  leave,
  subscribeConnections,
} from "@/lib/realtime/hub";
import { parseClientMessage, type ServerMessage } from "@/lib/realtime/protocol";
import {
  getMeeting,
  getVoiceSettings,
  listLanguages,
  getSecurityLimits,
  getMeetingLanguageConfigs,
  getPageByToken,
  isPageEnabled,
  listMeetings,
  type Meeting,
  type Page,
} from "@/lib/repo";
import {
  claimCapture,
  claimExclusiveCapture,
  releaseCapture,
  renewCapture,
  ownsCapture,
} from "@/lib/realtime/capture-lease";
import { engineKey, googleSpeechCredentials } from "@/lib/secrets";
import {
  buildCombinedSessionParams,
  buildSingleSessionParams,
  splitTranscribeHintLangs,
  TRANSCRIBE_HINT_LANGS,
} from "@/lib/transcribe-config";
import { singleTranscriptionProfile } from "@/lib/transcription-profile";
import { RescueAudioTurns, RESCUE_MAX_BYTES, rescueTranscribe } from "@/lib/transcription-rescue";
import { dropOverlap, OVERLAP_PCM_BYTES } from "@/lib/transcript-overlap";

declare global {
  var __liveConfTranslationAppRoot: string | undefined;
}

const { dev, port, hostname } = serverEnvironment();
// 0.0.0.0 으로 열어야 같은 네트워크의 참석자 기기에서 접속할 수 있다.
const appRoot = globalThis.__liveConfTranslationAppRoot ?? process.cwd();
initializeDiagnostics(diagnosticsDirectory() ?? joinPath(dirname(databasePath()), "logs"));
const buildId = (() => { try { return readFileSync(joinPath(appRoot, ".next", "BUILD_ID"), "utf8").trim(); } catch { return "development"; } })();
log("info", "server.start", { buildId, port, runtime: process.version });
globalThis.__liveConfDesktopOperations = desktopOperations;
globalThis.__liveConfSettingsChanged = notifyAppSettings;

const app = next({ dev, hostname, port, dir: appRoot });
const handle = app.getRequestHandler();

/** 이름을 안 준 속기사에게 붙일 순번. 사람이 서로를 구분할 수 있으면 충분하다. */
let anonymousCounter = 0;

const requestHandler = (req: Parameters<typeof handle>[0], res: Parameters<typeof handle>[1]) => {
  const requestId = randomUUID();
  const started = performance.now();
  const route = safeRoute(req.url ?? "/");
  res.setHeader("x-lct-request-id", requestId);
  res.setHeader("x-lct-build-id", buildId);
  res.once("close", () => log(res.statusCode >= 500 ? "error" : res.statusCode >= 400 || !res.writableFinished ? "warn" : "info", "http.complete",
    { requestId, route, method: req.method, status: res.statusCode, okay: res.writableFinished, durationMs: Math.round(performance.now() - started) }));
  if (!validateRequest(req, requestRequiresOrigin(req.method ?? "GET", req.url ?? "/"))) {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "invalid-origin" }));
    return;
  }
  req.headers["x-lct-request-id"] = requestId;
  if (!limitRequestBody(req, res)) return;
  if (req.method === "GET" && req.url === "/api/tunnel-probe") {
    const answer = tunnelProbeAnswer(req.headers.host, req.headers["x-tunnel-probe"]);
    res.writeHead(answer ? 200 : 404, { "cache-control": "no-store", "content-type": "text/plain" });
    res.end(answer ?? ""); return;
  }
  if (req.method === "GET" && req.url === "/api/health") {
    res.writeHead(200, {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    });
    res.end(
      JSON.stringify({
        service: "live-conf-translation",
        buildId,
        openMeetings: listMeetings().filter((meeting) => meeting.status === "open").length,
      }),
    );
    return;
  }

  const caPath = localHttpsCaPath();
  if (req.method === "GET" && req.url === "/local-ca.cer" && caPath && existsSync(caPath)) {
    res.writeHead(200, {
      "cache-control": "no-store",
      "content-disposition": 'attachment; filename="live-conf-translation-local-ca.cer"',
      "content-type": "application/pkix-cert",
    });
    res.end(readFileSync(caPath));
    return;
  }

  withContext({ requestId, route }, () => handle(req, res)).catch((error) => {
    log("error", "http.exception", { requestId, route, ...errorFields(error) });
    console.error("[http] 요청 처리 실패", error instanceof Error ? error.name : "Error");
    if (res.writableEnded) return;
    res.statusCode = 500;
    res.end("Internal Server Error");
  });
};

const server = createServer(requestHandler);

const wss = new WebSocketServer({ noServer: true, maxPayload: 32 * 1024 });
const transcriptionWss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });
const connectionsByIp = new Map<string, number>();
function admitConnection(ws: WebSocket, ip: string): void {
  const connectionId = randomUUID();
  const started = performance.now();
  log("info", "websocket.open", { connectionId });
  ws.once("error", (error) => log("warn", "websocket.error", { connectionId, ...errorFields(error) }));
  ws.once("close", (status) => log("info", "websocket.close", { connectionId, status, durationMs: Math.round(performance.now() - started) }));
  connectionsByIp.set(ip, (connectionsByIp.get(ip) ?? 0) + 1);
  ws.once("close", () => {
    const count = (connectionsByIp.get(ip) ?? 1) - 1;
    if (count) connectionsByIp.set(ip, count); else connectionsByIp.delete(ip);
  });
}
const liveSockets = new WeakSet<WebSocket>();
const statsAuth = new WeakMap<WebSocket, () => boolean>();
const pingTimer = setInterval(() => {
  for (const ws of wss.clients) {
    if (statsAuth.has(ws) && !statsAuth.get(ws)!()) { ws.close(1008, "Unauthorized"); continue; }
    if (!liveSockets.has(ws)) { ws.terminate(); continue; }
    liveSockets.delete(ws);
    ws.ping();
  }
}, 30_000);
pingTimer.unref();

function attachUpgrade(serverInstance: HttpServer | HttpsServer) {
serverInstance.on("upgrade", (request, socket, head) => {
  try {
  if (!validateRequest(request, true)) {
    log("warn", "websocket.rejected", { route: request.url, status: 403 });
    socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
    socket.destroy();
    return;
  }
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (url.pathname === "/ws/tunnel-probe") {
    const answer = tunnelProbeAnswer(request.headers.host, request.headers["x-tunnel-probe"]);
    if (!answer) { socket.write("HTTP/1.1 404 Not Found\r\n\r\n"); socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, (ws) => { ws.on("error", () => {}); ws.send(answer); ws.close(); });
    return;
  }
  const ip = connectionIp(request);
  const limits = getSecurityLimits();
  if (wss.clients.size + transcriptionWss.clients.size >= limits.connectionsTotal ||
    (connectionsByIp.get(ip) ?? 0) >= limits.connectionsPerIp) {
    log("warn", "websocket.rejected", { route: request.url, status: 429 });
    socket.write("HTTP/1.1 429 Too Many Requests\r\nRetry-After: 30\r\n\r\n");
    socket.destroy();
    return;
  }

  if (url.pathname === "/ws/transcribe") {
    const target = url.searchParams.get("test") === "1"
      ? resolveTestTarget(url, request) : resolveTranscriptionTarget(url);
    if (!target) {
      log("warn", "websocket.rejected", { route: request.url, status: 401 });
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    transcriptionWss.handleUpgrade(request, socket, head, (ws) => {
      admitConnection(ws, ip);
      attachTranscription(ws, target);
    });
    return;
  }

  if (url.pathname !== "/ws") {
    // Next 의 HMR 소켓 등 다른 업그레이드는 건드리지 않는다.
    return;
  }

  if (url.searchParams.get("stats") === "1") {
    if (!isAdminFromCookieHeader(request.headers.cookie)) {
      log("warn", "websocket.rejected", { route: request.url, status: 401 });
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      admitConnection(ws, ip);
      liveSockets.add(ws);
      ws.on("pong", () => liveSockets.add(ws));
      statsAuth.set(ws, () => isAdminFromCookieHeader(request.headers.cookie));
      const sendStats = (ids?: string[]) => {
        if (!statsAuth.get(ws)!()) { ws.close(1008, "Unauthorized"); return; }
        if (ws.readyState !== ws.OPEN) return;
        if (ws.bufferedAmount > MAX_VIEWER_BUFFERED_BYTES) { ws.close(1013, "Slow client"); return; }
        const message: ServerMessage = { t: "connection-stats", snapshot: !ids, at: Date.now(), ...sessionConnections(ids) };
        ws.send(JSON.stringify(message));
      };
      const unsubscribe = subscribeConnections({ changed: sendStats, close: () => ws.close(1008, "Unauthorized") });
      ws.on("close", unsubscribe);
      ws.on("error", unsubscribe);
      const sendSettings = () => {
        if (!statsAuth.get(ws)!()) { ws.close(1008, "Unauthorized"); return; }
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ t: "app-settings-changed" }));
      };
      ws.on("close", subscribeAppSettings(sendSettings));
      sendSettings();
      sendStats();
    });
    return;
  }

  const resolved = resolveConnectionTarget(url, request.headers.cookie);
  if (!resolved) {
    log("warn", "websocket.rejected", { route: request.url, status: 401 });
    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
    socket.destroy();
    return;
  }

  wss.handleUpgrade(request, socket, head, (ws) => {
    admitConnection(ws, ip);
    liveSockets.add(ws);
    ws.on("pong", () => liveSockets.add(ws));
    attach(ws, resolved, connectionIp(request));
  });
  } catch (error) {
    log("error", "websocket.upgrade-failed", { route: request.url, ...errorFields(error) });
    socket.destroy();
  }
});
}

attachUpgrade(server);

type Target = {
  meetingId: string;
  kind: Connection["kind"];
  lang: LanguageCode | null;
  clientId: string | null;
};

const connectionIpSchema = z.string().trim().min(1).max(64);

function connectionIp(request: IncomingMessage): string {
  const cloudflare = connectionIpSchema.safeParse(request.headers["x-lct-ip"]);
  const remote = connectionIpSchema.safeParse(request.socket.remoteAddress);
  const value = cloudflare.success ? cloudflare.data : remote.success ? remote.data : "—";
  return value.startsWith("::ffff:") ? value.slice(7) : value.slice(0, 64);
}

/**
 * 업그레이드 요청이 어느 회의의 무엇으로 붙으려는지 판정한다.
 *
 * 페이지는 URL 토큰으로, 대시보드는 관리자 쿠키로 인증한다.
 * 판정할 수 없으면 `null` 을 돌려 연결을 거절한다.
 */
function resolveConnectionTarget(url: URL, cookie: string | undefined): Target | null {
  const meetingId = url.searchParams.get("meeting");
  if (meetingId) {
    // 대시보드: 관리자만 회의 전체를 볼 수 있다.
    if (!isAdminFromCookieHeader(cookie)) return null;
    if (!getMeeting(meetingId)) return null;
    return { meetingId, kind: "dashboard", lang: null, clientId: null };
  }

  const token = url.searchParams.get("token");
  if (!token) return null;

  const page = getPageByToken(token);
  if (!page || !isPageEnabled(page)) return null;
  if (!getMeeting(page.meetingId)) return null;

  const requestedClientId = url.searchParams.get("clientId");
  const clientId = requestedClientId && /^[a-f0-9]{32}$/.test(requestedClientId)
    ? requestedClientId
    : null;
  return { meetingId: page.meetingId, kind: page.kind, lang: page.lang, clientId };
}

type TranscriptionTarget = {
  testAuthorized?: () => boolean;
  page: Page & { lang: LanguageCode };
  meeting: Meeting;
  clientId: string;
  languages: LanguageCode[];
  mode: "single" | "combined";
};

function resolveTestTarget(url: URL, request: IncomingMessage): TranscriptionTarget | null {
  const headers = new Headers();
  for (const key of ["x-forwarded-proto", "x-lct-ip"]) {
    const value = request.headers[key];
    const parsed = z.string().safeParse(value);
    if (parsed.success) headers.set(key, parsed.data);
  }
  if (!isAdminFromCookieHeader(request.headers.cookie) || !desktopTransportAllowed(url.href, headers)) return null;
  const lang = url.searchParams.get("source");
  const languages = listLanguages().map((row) => row.code);
  const provider = z.enum(["openai", "google", "local"]).safeParse(url.searchParams.get("provider"));
  const clientId = url.searchParams.get("clientId");
  if (lang === null || (lang && !languages.includes(lang)) || !languages.length || !provider.success || !clientId || !/^[a-f0-9]{32}$/.test(clientId)) return null;
  const id = `admin-test:${clientId}`;
  return { testAuthorized: () => isAdminFromCookieHeader(request.headers.cookie), clientId, languages: lang ? [lang] : languages, mode: lang ? "single" : "combined",
    page: { id, meetingId: "admin-test", token: "", kind: "input", lang: lang || languages[0], createdAt: Date.now() },
    meeting: { id: "admin-test", title: "", status: "open", engine: "openai", fallbackEngine: null,
      inputMode: "realtime", speakerLabels: false, translationModel: null, transcriptionProvider: provider.data,
      transcriptionContext: null, createdAt: Date.now(), closedAt: null } };
}

function resolveTranscriptionTarget(url: URL): TranscriptionTarget | null {
  const token = url.searchParams.get("token");
  const clientId = url.searchParams.get("clientId")?.slice(0, 100);
  if (!token || !clientId || clientId.length < 8) return null;
  const page = getPageByToken(token);
  const lang = page?.lang;
  if (!page || !lang || !isPageEnabled(page)) return null;
  const meeting = getMeeting(page.meetingId);
  if (!meeting || meeting.status !== "open") return null;
  if (page.kind === "combined-input") {
    const languages = getMeetingLanguageConfigs(meeting.id)
      .filter((row) => row.inputEnabled)
      .map((row) => row.lang);
    return {
      page: { ...page, lang },
      meeting,
      clientId,
      languages,
      mode: "combined",
    };
  }
  if (
    (page.kind !== "input" && page.kind !== "capture") ||
    (page.kind === "capture" && meeting.inputMode !== "realtime")
  ) return null;
  return {
    page: { ...page, lang },
    meeting,
    clientId,
    languages: [lang],
    mode: "single",
  };
}

const openAiTranscriptionEventSchema = z.object({
  type: z.string().optional(),
  item_id: z.string().optional(),
  content_index: z.number().optional(),
  delta: z.string().optional(),
  transcript: z.string().optional(),
  languages: z.array(z.object({ code: z.string().optional() })).optional(),
  error: z.object({ message: z.string().optional() }).optional(),
});
type OpenAiTranscriptionEvent = z.infer<typeof openAiTranscriptionEventSchema>;

const transcriptionClientMessageSchema = z.union([
  z.object({
    t: z.literal("start"),
    speakerName: z.string().optional(),
    lang: z.string().trim().min(1).max(35).optional(),
    autoSubmit: z.boolean().optional(),
  }),
  z.object({ t: z.literal("heartbeat") }),
  z.object({ t: z.literal("commit"), overlap: z.boolean().optional() }),
  z.object({ t: z.literal("clear") }),
]);

type TranscriptionServerMessage =
  | { t: "voice-settings"; settings: VoiceSettings }
  | { t: "error"; reason: "busy" | "key-required" | "google-unavailable" | "local-unavailable" | "speaker-required" | "invalid-language" | "lost" }
  | { t: "ready"; leaseId: string | null }
  | { t: "partial"; text: string }
  | {
      t: "transcript";
      itemId: string;
      contentIndex: number;
      body: string;
      lang: LanguageCode;
      usedFallback: boolean;
      leaseId: string | null;
      replaceLastWord?: boolean;
    };

type OpenAiTranscriptionSettings = {
  model: string;
  languages?: string[];
  keywords: string[];
  delay?: "minimal" | "low" | "medium" | "high" | "xhigh";
  prompt: string;
};

const PARTIAL_INTERVAL_MS = 50;
const MAX_VIEWER_BUFFERED_BYTES = 512 * 1024;

/**
 * 서버가 직접 받은 음성(Zoom 회의 등)을 /ws/transcribe 와 같은 처리에 붙이는 메모리 소켓.
 * 브라우저 경로의 동작은 그대로 두고, 같은 전사·재전사·문자 검사·lease·동시 한도를 쓴다.
 */
/** attachTranscription 이 쓰는 소켓 기능만. 브라우저 WebSocket과 서버 내부 소켓이 모두 맞춘다. */
type TranscriptionSocket = {
  readonly readyState: number;
  readonly OPEN: number;
  send: (data: string) => void;
  close: (code?: number, reason?: string) => void;
  on: ((event: "message", listener: (raw: RawData, binary: boolean) => void) => void) &
    ((event: "close" | "error", listener: () => void) => void);
};
type TranscriptionClientMessage = z.infer<typeof transcriptionClientMessageSchema>;

class InternalTranscriptionSocket extends EventEmitter implements TranscriptionSocket {
  readonly OPEN = 1;
  readyState = 1;
  constructor(private readonly onEvent: InternalTranscriptionRequest["onEvent"]) { super(); }
  send(data: string) {
    let message: TranscriptionServerMessage;
    try { message = JSON.parse(data); } catch { return; }
    if (message.t === "ready") this.onEvent({ t: "ready" });
    else if (message.t === "transcript") this.onEvent({ t: "transcript", itemId: message.itemId, body: message.body, lang: message.lang });
    else if (message.t === "error") this.onEvent({ t: "error", reason: message.reason });
  }
  close() {
    if (this.readyState !== 1) return;
    this.readyState = 3;
    this.emit("close");
    this.onEvent({ t: "closed" });
  }
}

globalThis.__liveConfInternalTranscription = (request) => {
  const meeting = getMeeting(request.meetingId);
  const languages = request.languages.filter(Boolean);
  if (!meeting || meeting.status !== "open" || !languages.length) return null;
  const socket = new InternalTranscriptionSocket(request.onEvent);
  const id = `internal:${meeting.id}:${request.streamKey}`;
  attachTranscription(socket, {
    testAuthorized: request.authorized, clientId: id, languages, mode: "combined",
    page: { id, meetingId: meeting.id, token: "", kind: "combined-input", lang: languages[0]!, createdAt: Date.now() },
    meeting,
  });
  const message = (value: TranscriptionClientMessage) => socket.emit("message", Buffer.from(JSON.stringify(value)), false);
  return {
    start: (input) => message({ t: "start", speakerName: input.speakerName, lang: input.lang, autoSubmit: true }),
    audio: (pcm) => socket.emit("message", pcm, true),
    commit: () => message({ t: "commit" }),
    heartbeat: () => message({ t: "heartbeat" }),
    close: () => socket.close(),
  };
};

function attachTranscription(ws: TranscriptionSocket, target: TranscriptionTarget) {
  const connectionId = randomUUID();
  log("info", "transcription.open", { connectionId, meetingId: target.meeting.id, provider: target.meeting.transcriptionProvider });
  const local = target.meeting.transcriptionProvider === "local";
  const google = target.meeting.transcriptionProvider === "google";
  let upstream: WsSocket | null = null;
  let leaseId: string | null = null;
  let speakerName: string | null = null;
  let selectedLang: LanguageCode | null = null;
  let started = false;
  let closed = false;
  const abort = new AbortController();
  let lastHeartbeat = Date.now();
  // 브라우저는 ready 뒤에만 하트비트를 보낸다. 로컬 Whisper 첫 시작(최대 60초)을 끊지 않게 준비 전에는 더 기다린다.
  let readySent = false;
  let turnBytes = 0;
  let queuedSegments = 0;
  let openaiPending = 0;
  let queuedBytes = 0;
  let audioAllowance = 256 * 1024;
  let lastAudio = Date.now();
  let waitingSince = 0;
  const watchdog = setInterval(() => {
    if (Date.now() - lastHeartbeat >= (readySent ? 30_000 : 90_000) || (target.testAuthorized && !target.testAuthorized()) || (leaseId && (!ownsCapture(target.page.id, leaseId) ||
      (!target.testAuthorized && (getMeeting(target.meeting.id)?.status !== "open" || !isPageEnabled(target.page))))) ||
      (waitingSince && Date.now() - waitingSince >= 60_000)) fail("lost");
    else expireHead();
  }, 1000);
  watchdog.unref();
  const committed: string[] = [];
  const committedAt = new Map<string, number>();
  // 강제 컷 뒤 끝 1초를 겹쳐 보낸 턴. 커밋 순서대로 item_id 에 결합해 앞 전사와 겹친 말을 걷어 낸다.
  let recentPcm = Buffer.alloc(0);
  const overlapQueue: boolean[] = [];
  const overlapped = new Set<string>();
  let previousBody = "";
  // 기다리다 포기한 항목. 늦게 온 결과는 이미 부분 전사로 저장했으므로 버린다(중복 방지).
  const abandoned = new Set<string>();
  const completedEvents = new Map<string, OpenAiTranscriptionEvent>();
  const partials = new Map<string, string>();
  let partialTimer: ReturnType<typeof setTimeout> | null = null;
  let nextTranscript = 0;
  let draining = false;
  let bufferedPcm: Buffer[] = [];
  let bufferedBytes = 0;
  let serverQueue = Promise.resolve();

  // 2차 전사(rescue)는 힌트 미지원 언어가 있는 세션에서만 의미가 있다 —
  // 그런 언어가 없으면 문자 교차 검증으로 충분하므로 PCM 을 쌓지 않는다.
  let rescueEnabled = false;
  let sessionKey: string | null = null;
  let rescuePrompt = "";
  let rescueAudio: RescueAudioTurns | null = null;

  const send = (message: TranscriptionServerMessage) => {
    if (message.t === "ready" && !readySent) { readySent = true; lastHeartbeat = Date.now(); }
    if (message.t === "ready" || message.t === "error" || message.t === "transcript") log(message.t === "error" ? "warn" : "info", `transcription.${message.t}`,
      { connectionId, meetingId: target.meeting.id, provider: target.meeting.transcriptionProvider,
        reason: message.t === "error" ? message.reason : undefined, bytes: message.t === "transcript" ? Buffer.byteLength(message.body) : undefined });
    if (!closed && ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  };
  const sendVoiceSettings = () => send({ t: "voice-settings", settings: getVoiceSettings() });
  const unsubscribeSettings = subscribeAppSettings(sendVoiceSettings);
  sendVoiceSettings();
  const flushPartial = () => {
    if (partialTimer) clearTimeout(partialTimer);
    partialTimer = null;
    send({ t: "partial", text: [...partials.values()].join(" ") });
  };
  const schedulePartial = () => {
    if (partialTimer) return;
    partialTimer = setTimeout(flushPartial, PARTIAL_INTERVAL_MS);
  };
  const cleanup = () => {
    if (closed) return;
    log("info", "transcription.close", { connectionId, meetingId: target.meeting.id });
    closed = true;
    unsubscribeSettings();
    clearInterval(watchdog);
    abort.abort();
    bufferedPcm = [];
    bufferedBytes = 0;
    rescueAudio = null;
    committed.length = 0;
    completedEvents.clear();
    partials.clear();
    if (partialTimer) clearTimeout(partialTimer);
    partialTimer = null;
    if (leaseId) releaseCapture(target.page.id, leaseId);
    upstream?.terminate();
    upstream = null;
    ws.close(1000);
  };
  const fail = (reason: "busy" | "key-required" | "google-unavailable" | "local-unavailable" | "speaker-required" | "invalid-language" | "lost") => {
    send({ t: "error", reason });
    cleanup();
    ws.close(1011, reason);
  };

  const localParams = () => selectedLang
    ? buildSingleSessionParams(selectedLang, target.meeting.title, {
        context: target.meeting.transcriptionContext,
        speaker: speakerName,
      })
    : target.mode === "combined"
    ? buildCombinedSessionParams(
        target.languages,
        target.page.lang,
        target.meeting.title,
        { context: target.meeting.transcriptionContext, speaker: speakerName },
      )
    : buildSingleSessionParams(target.page.lang, target.meeting.title, {
        farField: target.page.kind === "capture",
        context: target.meeting.transcriptionContext,
        speaker: speakerName,
      });

  const commitServerTranscription = () => {
    if (closed || !started) return;
    if (queuedSegments >= 4 || queuedBytes + bufferedBytes > 6 * 1024 * 1024) { fail("busy"); return; }
    const pcm = Buffer.concat(bufferedPcm, bufferedBytes);
    bufferedPcm = [];
    bufferedBytes = 0;
    send({ t: "partial", text: "" });
    const itemId = randomUUID();
    const params = localParams();
    queuedSegments++;
    queuedBytes += pcm.length;
    serverQueue = serverQueue.then(async () => {
      if (closed) return;
      if (pcm.byteLength < 9_600) {
        send({ t: "transcript", itemId, contentIndex: 0, body: "", lang: selectedLang ?? target.page.lang, usedFallback: false, leaseId });
        return;
      }
      const requestedLang = selectedLang ?? target.page.lang;
      const result = google
        ? await transcribeGooglePcm({ pcm, lang: requestedLang, keywords: params.keywords, signal: abort.signal })
        : await transcribeLocalPcm({
            pcm,
            languages: selectedLang ? [selectedLang] : target.languages,
            prompt: params.prompt,
            signal: abort.signal,
          });
      const lang = selectedLang ?? result.lang ?? target.page.lang;
      send({
        t: "transcript",
        itemId,
        contentIndex: 0,
        body: result.body,
        lang,
        usedFallback: target.mode === "combined" && !selectedLang,
        leaseId,
      });
    }).catch(() => {
      console.error(`[${google ? "google" : "local"}-transcribe] 확정 전사 실패`);
      if (!closed) fail("lost");
    }).finally(() => {
      queuedSegments--;
      queuedBytes -= pcm.length;
    });
  };
  const handleCompleted = async (itemId: string, event: OpenAiTranscriptionEvent) => {
    let body = event.transcript?.trim() ?? "";
    let lang = selectedLang ?? target.page.lang;
    let usedFallback = false;
    let scripted: LanguageCode | null = null;
    let detected: LanguageCode | null = null;
    if (target.mode === "combined" && !selectedLang) {
      detected = matchDetectedLanguage(event.languages?.[0]?.code, target.languages);
      // 문자 증거가 모델 감지와 다르면 문자를 우선한다 — 한글·태국어·싱할라
      // 문자 영역은 짧은 발화에서도 흔들리지 않는다.
      scripted = scriptLanguageOf(body, target.languages);
      lang = scripted ?? detected ?? target.page.lang;
      usedFallback = !scripted && !detected;
    }

    // item_id 에 커밋 시점의 경계를 먼저 결합해 두었으므로 완료 순서가 뒤집혀도
    // 다른 턴의 PCM 을 rescue 에 보내지 않는다.
    const turnPcm = rescueAudio?.take(itemId) ?? null;

    // 문자·감지 증거가 모두 없거나(폴백) 둘이 충돌하는 턴은 배치로 한 번 더 듣는다.
    // 충돌 예: 문자는 싱할라인데 감지는 bn/ta — 실측에서 이 경우 절반은 깨진 문자열이었다.
    // 세 번째 경우: 감지는 한국어인데 문자에 한글이 한 글자도 없는 경우처럼, 감지 결과를
    // 문자가 뒷받침하지 못하는 턴(실측에서 Thaana 음역을 ko 로 저장하는 사고가 있었다).
    const rawDetected = event.languages?.[0]?.code?.toLowerCase().split("-")[0] ?? null;
    const conflict = Boolean(
      scripted && rawDetected && rawDetected !== scripted.toLowerCase().split("-")[0],
    );
    const contradicted = Boolean(
      !scripted && detected && hasScriptEvidence(body, detected) === false,
    );
    const fixedLang = selectedLang ?? (target.mode === "single" ? target.page.lang : null);
    const fixedPrimary = fixedLang?.toLowerCase().split("-")[0] ?? null;
    // 빈 턴은 싱할라 고정만 다시 듣는다. 그 결과는 깨끗한 싱할라 문자일 때만 받으므로,
    // 다른 언어에서 무음을 재전사하면 생기는 "감사합니다" 같은 환각을 저장하지 않는다.
    const wrongFixedScript = Boolean(
      fixedLang &&
        (fixedPrimary === "si"
          ? needsSinhalaRescue(body)
          : Boolean(body) && hasScriptEvidence(body, fixedLang) === false),
    );
    // 실측: Realtime 전사가 같은 화자에게 빈 결과를 연달아 돌려주는 구간이 있었다(배치 전사는 같은 음성을 정상 인식).
    // 2초 이상 말한 턴이 비어 오면 배치로 한 번 더 듣는다.
    const emptyTurn = !body && !local && !google && Boolean(turnPcm && turnPcm.byteLength >= 2 * 48_000);
    if ((((usedFallback && body) || conflict || contradicted || wrongFixedScript) && rescueEnabled || emptyTurn) && sessionKey) {
      if (turnPcm && turnPcm.byteLength <= RESCUE_MAX_BYTES) {
        const rescueLang = wrongFixedScript || emptyTurn ? fixedLang ?? undefined : undefined;
        // `language=si` 는 배치 API도 400으로 거부한다. 실시간 힌트와 같은
        // 지원 목록을 쓰고, 미지원 언어는 이미 강한 프롬프트에만 맡긴다.
        const apiLanguage = rescueLang && TRANSCRIBE_HINT_LANGS.includes(
          rescueLang.toLowerCase().split("-")[0],
        )
          ? rescueLang.toLowerCase().split("-")[0]
          : undefined;
        const rescued = await rescueTranscribe({
          pcm: turnPcm,
          key: sessionKey,
          prompt: rescuePrompt,
          language: apiLanguage,
          signal: abort.signal,
        });
        let rescueStatus = "failed";
        if (rescued) {
          // 언어를 고정한 재전사는 그 문자가 실제로 나온 경우만, 자동 재전사는
          // 문자 증거가 세션 언어 하나를 가리킨 경우만 받아들인다.
          // 빈 턴 재전사는 고유 문자가 없는 언어(es·en 등)도 받는다. 다른 문자가 나온 경우만 거른다.
          const rescuedLang = rescueLang
            ? (rescueLang.toLowerCase().split("-")[0] === "si"
                ? hasCleanSinhalaScript(rescued)
                : emptyTurn
                  ? hasScriptEvidence(rescued, rescueLang) !== false && (scriptLanguageOf(rescued, target.languages) ?? rescueLang) === rescueLang
                  : hasScriptEvidence(rescued, rescueLang) === true)
              ? rescueLang
              : null
            : scriptLanguageOf(rescued, target.languages) ?? (emptyTurn ? lang : null);
          if (rescuedLang) {
            body = rescued;
            lang = rescuedLang;
            usedFallback = false;
            rescueStatus = "accepted";
          } else {
            rescueStatus = "rejected-script";
          }
        }
        console.warn(
          `[rescue] item=${itemId} duration=${(turnPcm.byteLength / 48_000).toFixed(1)}s status=${rescueStatus}`,
        );
        if (emptyTurn) log("warn", "transcription.empty-rescue", { connectionId, meetingId: target.meeting.id, durationMs: Math.round(turnPcm.byteLength / 48), phase: rescueStatus, bytes: Buffer.byteLength(body) });
      } else {
        console.warn(`[rescue] item=${itemId} status=skipped-audio`);
      }
    }

    let replaceLastWord = false;
    if (overlapped.delete(itemId) && body && previousBody) {
      const trimmed = dropOverlap(previousBody, body);
      log("info", "transcription.overlap", { connectionId, meetingId: target.meeting.id, count: body.length - trimmed.text.length, okay: trimmed.replaceLastWord });
      body = trimmed.text;
      replaceLastWord = trimmed.replaceLastWord;
    }
    if (body) previousBody = body;

    // 빈 전사도 보낸다. 브라우저는 커밋마다 응답 하나를 기다리므로, 안 보내면 중지가 60초 동안 끝나지 않는다.
    send({
      t: "transcript",
      itemId,
      contentIndex: event.content_index ?? 0,
      body,
      lang,
      usedFallback: usedFallback && Boolean(body),
      leaseId,
      replaceLastWord: replaceLastWord || undefined,
    });
  };

  /**
   * 맨 앞 항목의 결과가 오지 않으면 뒤 결과까지 모두 막혀 초안만 길게 쌓인다. 뒤 결과가 먼저 왔으면 15초,
   * 아니어도 30초를 넘기면 그 항목은 지금까지 받은 부분 전사로 확정하고 넘어간다.
   */
  const expireHead = () => {
    if (draining || nextTranscript || !committed.length) return;
    const itemId = committed[0];
    if (completedEvents.has(itemId)) return;
    const waited = Date.now() - (committedAt.get(itemId) ?? Date.now());
    const laterDone = committed.some((id, index) => index > 0 && completedEvents.has(id));
    if (waited < (laterDone ? 15_000 : 30_000)) return;
    const partial = partials.get(itemId) ?? "";
    log("warn", "transcription.item-timeout", { connectionId, meetingId: target.meeting.id, durationMs: waited, bytes: Buffer.byteLength(partial) });
    abandoned.add(itemId);
    openaiPending = Math.max(0, openaiPending - 1);
    partials.delete(itemId);
    flushPartial();
    completedEvents.set(itemId, { type: "conversation.item.input_audio_transcription.completed", item_id: itemId, content_index: 0, transcript: partial });
    void drainCompleted();
  };

  const drainCompleted = async () => {
    if (draining) return;
    draining = true;
    try {
      while (!closed && nextTranscript < committed.length) {
        const itemId = committed[nextTranscript];
        const event = completedEvents.get(itemId);
        if (!event) break;
        nextTranscript += 1;
        completedEvents.delete(itemId);
        committedAt.delete(itemId);
        await handleCompleted(itemId, event);
      }
      // 결과가 하나라도 나왔으면 대기 시계를 다시 잰다. 계속 말하는 세션은 항상 대기 항목이 있어
      // 처음 시각을 유지하면 60초마다 연결이 끊긴다.
      const progressed = nextTranscript > 0;
      if (nextTranscript) { committed.splice(0, nextTranscript); nextTranscript = 0; }
      waitingSince = committed.length || completedEvents.size ? (progressed ? Date.now() : waitingSince || Date.now()) : 0;
    } finally {
      draining = false;
      if (
        nextTranscript < committed.length &&
        completedEvents.has(committed[nextTranscript])
      ) void drainCompleted();
    }
  };

  const start = () => {
    const limits = getSecurityLimits();
    const active = [...activeTranscriptions().values()];
    if (target.testAuthorized ? !target.testAuthorized() : getMeeting(target.meeting.id)?.status !== "open" || !isPageEnabled(target.page)) { fail("lost"); return; }
    if (active.some((entry) => entry.meetingId === target.meeting.id && entry.clientId === target.clientId) ||
      active.length >= limits.transcriptionTotal ||
      active.filter((entry) => entry.meetingId === target.meeting.id).length >= limits.transcriptionPerSession ||
      rateLimit(`voice:participant:${target.meeting.id}:${target.clientId}`, 3 / 60, 3) ||
      rateLimit(`voice:session:${target.meeting.id}`, 30 / 60, 30)) { fail("busy"); return; }
    if (local && !localTranscriptionConfigured()) {
      fail("local-unavailable");
      return;
    }
    if (google && !googleSpeechCredentials()) {
      fail("google-unavailable");
      return;
    }
    const lease = target.mode === "combined"
      ? claimExclusiveCapture(target.meeting.id, target.page.id, target.clientId)
      : claimCapture(target.meeting.id, target.page.id, target.clientId);
    if (!lease) {
      fail("busy");
      return;
    }
    leaseId = lease.leaseId;
    activeTranscriptions().set(leaseId, {
      meetingId: target.meeting.id, pageId: target.page.id, clientId: target.clientId,
      signal: abort.signal, stop: () => fail("lost"),
    });
    if (local) {
      void ensureLocalTranscriptionRuntime().then(() => {
        if (closed) return;
        send({ t: "ready", leaseId });
      }).catch((error) => {
        console.error("[local-transcribe] 시작 실패", error);
        if (!closed) fail("local-unavailable");
      });
      return;
    }
    if (google) {
      send({ t: "ready", leaseId });
      return;
    }

    const key = engineKey("openai");
    if (!key) {
      fail("key-required");
      return;
    }
    sessionKey = key;
    const params = localParams();
    {
      rescuePrompt = params.prompt +
        (params.keywords.length ? ` Terminology: ${params.keywords.join(", ")}.` : "");
    }

    // 전사 세션은 모델명이 아니라 intent=transcription 으로 연다.
    // ?model=gpt-transcribe 는 현재 API 가 거부한다(전사 모델은 세션 모델이 될 수 없다).
    upstream = new WsSocket(openaiRealtimeTranscribeUrl(), {
      maxPayload: 256 * 1024,
      headers: {
        authorization: `Bearer ${key}`,
        "OpenAI-Safety-Identifier": createHash("sha256")
          .update(target.page.id)
          .digest("hex"),
      },
    });
    upstream.on("open", () => {
      const transcription: OpenAiTranscriptionSettings = {
        model: params.model,
        keywords: params.keywords,
        prompt: params.prompt,
      };
      if (params.languages.length) transcription.languages = params.languages;
      if (params.delay) transcription.delay = params.delay;
      upstream?.send(JSON.stringify({
        type: "session.update",
        session: {
          type: "transcription",
          audio: {
            input: {
              format: { type: "audio/pcm", rate: 24000 },
              noise_reduction: { type: params.noiseReduction },
              transcription,
              turn_detection: null,
            },
          },
        },
      }));
    });
    upstream.on("message", (raw) => {
      if (closed) return;
      if (committed.length + completedEvents.size + partials.size > 64) { fail("lost"); return; }
      let value;
      try {
        value = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const parsed = openAiTranscriptionEventSchema.safeParse(value);
      if (!parsed.success) return;
      const event = parsed.data;
      if (event.type === "session.updated" || event.type === "transcription_session.updated") {
        send({ t: "ready", leaseId });
        return;
      }
      if (event.type === "input_audio_buffer.committed" && event.item_id) {
        if (overlapQueue.shift()) overlapped.add(event.item_id);
        committed.push(event.item_id);
        committedAt.set(event.item_id, Date.now());
        waitingSince ||= Date.now();
        rescueAudio?.bindCommit(event.item_id);
        void drainCompleted();
        return;
      }
      if (!event.item_id) {
        if (event.type === "error") fail("lost");
        return;
      }
      if (event.type === "conversation.item.input_audio_transcription.delta") {
        partials.set(event.item_id, (partials.get(event.item_id) ?? "") + (event.delta ?? ""));
        if ((partials.get(event.item_id)?.length ?? 0) > 10000) { fail("lost"); return; }
        schedulePartial();
      } else if (
        event.type === "conversation.item.input_audio_transcription.completed" ||
        event.type === "conversation.item.input_audio_transcription.failed"
      ) {
        // 실패한 턴은 빈 전사로 처리해 뒤 턴을 막지 않는다.
        if (event.type.endsWith(".failed")) console.warn(`[transcribe] item=${event.item_id} 전사 실패`);
        if (abandoned.delete(event.item_id)) return;
        openaiPending = Math.max(0, openaiPending - 1);
        partials.delete(event.item_id);
        flushPartial();
        completedEvents.set(event.item_id, event.type.endsWith(".failed") ? { ...event, transcript: "" } : event);
        void drainCompleted();
      }
    });
    upstream.on("close", () => {
      if (!closed) fail("lost");
    });
    upstream.on("error", () => {
      if (!closed) fail("lost");
    });
  };

  ws.on("message", (raw, binary) => {
    if (closed) return;
    if (binary) {
      if (!started) return;
      const audio = Buffer.isBuffer(raw)
        ? raw
        : Array.isArray(raw)
          ? Buffer.concat(raw)
          : Buffer.from(raw);
      if (audio.byteLength > 256 * 1024) {
        ws.close(1009, "Audio frame too large");
        return;
      }
      const now = Date.now();
      audioAllowance = Math.min(256 * 1024, audioAllowance + (now - lastAudio) * 48);
      lastAudio = now;
      audioAllowance -= audio.length;
      turnBytes += audio.length;
      // Allow a 30-second turn plus up to 20 seconds of leading silence and delivery headroom.
      if (audio.length % 2 || audioAllowance < 0 || turnBytes > RESCUE_MAX_BYTES || queuedBytes + turnBytes > 6 * 1024 * 1024) {
        fail("busy"); return;
      }
      if (local || google) {
        bufferedPcm.push(audio);
        bufferedBytes += audio.byteLength;
        return;
      }
      if (!upstream || upstream.readyState !== WsSocket.OPEN) return;
      // 2차 전사(rescue)용으로 원시 PCM 을 세션 동안만 보관한다.
      rescueAudio?.append(audio);
      recentPcm = Buffer.concat([recentPcm, audio]).subarray(-OVERLAP_PCM_BYTES);
      upstream.send(JSON.stringify({
        type: "input_audio_buffer.append",
        audio: audio.toString("base64"),
      }));
      return;
    }

    let value;
    try {
      value = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const parsed = transcriptionClientMessageSchema.safeParse(value);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.t === "start" && !started) {
      speakerName = message.speakerName?.trim().slice(0, 40) || null;
      if (message.lang) {
        if (target.mode !== "combined" || !target.languages.includes(message.lang)) {
          fail("invalid-language");
          return;
        }
        selectedLang = message.lang;
      }
      if (target.page.kind !== "capture" && target.meeting.speakerLabels && !speakerName) {
        fail("speaker-required");
        return;
      }
      const rescueLangs = selectedLang
        ? [selectedLang]
        : target.mode === "single"
          ? [target.page.lang]
          : target.languages;
      rescueEnabled =
        !local && !google && splitTranscribeHintLangs(
          rescueLangs,
          selectedLang
            ? singleTranscriptionProfile(selectedLang).model
            : target.mode === "single"
              ? singleTranscriptionProfile(target.page.lang).model
              : "gpt-transcribe",
        ).unsupported.length > 0;
      // 빈 결과 재전사를 위해 OpenAI 경로는 항상 턴 음성을 잠시 보관한다(최대 60초).
      rescueAudio = !local && !google ? new RescueAudioTurns() : null;
      started = true;
      start();
    } else if (message.t === "heartbeat" && leaseId) {
      lastHeartbeat = Date.now();
      if (!renewCapture(target.page.id, leaseId)) fail("lost");
    } else if (message.t === "clear" && started) {
      turnBytes = 0;
      bufferedPcm = [];
      bufferedBytes = 0;
      rescueAudio?.discardCurrent();
      if (upstream?.readyState === WsSocket.OPEN) upstream.send(JSON.stringify({ type: "input_audio_buffer.clear" }));
    } else if (message.t === "commit") {
      if (!started || !turnBytes) return;
      turnBytes = 0;
      if (local || google) commitServerTranscription();
      else if (upstream?.readyState === WsSocket.OPEN) {
        if (openaiPending >= 4) { fail("busy"); return; }
        openaiPending++;
        waitingSince ||= Date.now();
        const overlap = message.overlap ? recentPcm : null;
        rescueAudio?.markCommit(overlap?.byteLength ?? 0);
        overlapQueue.push(Boolean(overlap?.byteLength));
        upstream.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
        if (overlap?.byteLength) {
          upstream.send(JSON.stringify({ type: "input_audio_buffer.append", audio: overlap.toString("base64") }));
          turnBytes = overlap.byteLength;
        }
      }
    }
  });
  ws.on("close", cleanup);
  ws.on("error", cleanup);
}

function attach(ws: WebSocket, target: Target, ip: string) {
  const clientId = target.clientId ?? randomUUID();

  // 이름은 입력 페이지에서만 쓰인다(서로를 구분해야 하므로). 보기 전용 연결에는
  // 번호를 붙이지 않는다 — 참석자에게 "입력자 3" 이라는 이름이 생기면 혼란스럽다.
  const name =
    target.kind === "input" || target.kind === "combined-input"
      ? `#${(anonymousCounter += 1)}`
      : "";

  const connection: Connection = {
    clientId,
    meetingId: target.meetingId,
    kind: target.kind,
    lang: target.lang,
    name,
    nameClaimed: false,
    ip,
    draft: "",
    send: (message: ServerMessage, serialized?: string) => {
      if (ws.readyState !== ws.OPEN) return;
      if (
        (target.kind === "output" || target.kind === "combined") &&
        ws.bufferedAmount > MAX_VIEWER_BUFFERED_BYTES
      ) {
        ws.close(1013, "Slow client");
        return;
      }
      ws.send(serialized ?? JSON.stringify(message));
    },
    close: () => ws.close(1008, "Page disabled"),
  };

  join(connection);
  connection.send({ t: "hello", clientId, name: connection.name });

  if ((connection.kind === "input" || connection.kind === "combined-input") && connection.lang) {
    broadcastPresence(connection.meetingId, connection.lang, connection.kind);
  }

  ws.on("message", (raw) => {
    const message = parseClientMessage(raw.toString());
    if (!message) return;

    // 초안과 이름은 입력 페이지에서만 의미가 있다.
    if (
      (connection.kind !== "input" && connection.kind !== "combined-input") ||
      !connection.lang
    ) return;

    if (message.t === "draft") connection.draft = message.text;
    if (message.t === "name") {
      const claimed = claimInputName(connection, message.name);
      connection.send(
        claimed
          ? { t: "name-result", ok: true, name: connection.name }
          : { t: "name-result", ok: false, reason: "duplicate" },
      );
    }

    broadcastPresence(connection.meetingId, connection.lang, connection.kind);
  });

  const cleanup = () => {
    leave(connection);
    if ((connection.kind === "input" || connection.kind === "combined-input") && connection.lang) {
      broadcastPresence(connection.meetingId, connection.lang, connection.kind);
    }
  };

  ws.on("close", cleanup);
  ws.on("error", cleanup);
}

/**
 * 최상위 await 대신 함수로 감싼다 — tsx 는 이 파일을 CJS 로 변환하는데
 * CJS 출력은 최상위 await 를 지원하지 않는다.
 */
async function main() {
  globalThis.__liveConfServerStarted = true;
  await app.prepare();

  server.listen(port, hostname, () => {
    startServerControl();
    startNamedTunnelControl();
    log("info", "server.ready", { port, buildId });
    console.log(`▲ 실시간 세션 번역 서버: http://${hostname}:${port}`);
    if (dev) console.log("  개발 모드");
  });

  const pfxPath = localHttpsPfxPath();
  const pfxPassword = localHttpsPfxPassword();
  if (pfxPath && pfxPassword && existsSync(pfxPath)) {
    const httpsServer = createHttpsServer(
      { pfx: readFileSync(pfxPath), passphrase: pfxPassword },
      requestHandler,
    );
    attachUpgrade(httpsServer);
    httpsServer.listen(localHttpsPort(), hostname, () => {
      console.log(`▲ 로컬 HTTPS: https://${hostname}:${localHttpsPort()}`);
      log("info", "server.https-ready", { port: localHttpsPort(), buildId });
    });
  }
}

main().catch(async (error) => {
  log("error", "server.start-failed", errorFields(error));
  await flushDiagnostics();
  console.error("[server] 기동 실패", error);
  process.exit(1);
});
