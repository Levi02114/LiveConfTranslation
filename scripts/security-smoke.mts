// Run after npm run build: node --conditions=react-server --import tsx scripts/security-smoke.mts
import assert from "node:assert/strict";
import { createServer, request as rawRequest } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket, WebSocketServer } from "ws";

const directory = mkdtempSync(join(tmpdir(), "lct-security-smoke-"));
const origin = "http://127.0.0.1:3137";
process.env.DATABASE_PATH = join(directory, "test.db");
process.env.SESSION_SECRET = "security-smoke-test-only-secret";
process.env.ADMIN_PASSWORD = "security-smoke-test-password";
let holdTranslations = false;
let holdRewrite = false;
let releaseTranslations = () => {};
let releaseRewrite = () => {};
let translationGate = Promise.resolve();
let rewriteGate = Promise.resolve();
let providerConnections = 0;
let providerCalls = 0;
const provider = createServer(async (request, response) => {
  if (request.url === "/v1/models") { response.end(JSON.stringify({ data: [{ id: "gpt-5.6-luna" }] })); return; }
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  const payload = JSON.parse(Buffer.concat(chunks).toString());
  const system = String(payload.messages?.[0]?.content ?? "");
  let content = "xin chào";
  if (system.includes("Detect the language")) {
    if (holdRewrite) await rewriteGate;
    content = JSON.stringify({ language: "vi" });
  } else if (system.includes("Conservatively correct")) {
    if (holdRewrite) await rewriteGate;
    content = JSON.stringify({ text: "보정한 문장" });
  } else {
    providerCalls++;
    if (holdTranslations) await translationGate;
  }
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ choices: [{ message: { content } }] }));
});
const providerWs = new WebSocketServer({ server: provider });
providerWs.on("connection", (ws) => {
  providerConnections++;
  ws.on("close", () => providerConnections--);
  ws.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.type === "session.update") ws.send(JSON.stringify({ type: "session.updated" }));
    if (message.type === "input_audio_buffer.commit") {
      const id = crypto.randomUUID();
      ws.send(JSON.stringify({ type: "input_audio_buffer.committed", item_id: id }));
      ws.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", item_id: id, transcript: "안녕하세요", content_index: 0 }));
    }
  });
});
await new Promise<void>((resolve) => provider.listen(3138, "127.0.0.1", resolve));
const repo = await import("../src/lib/repo");
const { getDb } = await import("../src/lib/db");
const { encryptSecret } = await import("../src/lib/crypto");
repo.upsertEngineSecret({ engine: "openai", secret: encryptSecret("fake-security-test-key"), hint: "fake" });
const createMeeting = () => repo.createMeeting({ title: "Security smoke", engine: "openai", config: {
  languages: ["ko", "vi"].map((lang) => ({ lang, inputEnabled: true, outputEnabled: true })),
  speakerLabels: false, combinedInputFallbackLang: "ko",
} });
const meeting = createMeeting();
const pages = repo.getMeetingPages(meeting.id);
const input = pages.find((page) => page.kind === "input" && page.lang === "ko")!;
const output = pages.find((page) => page.kind === "output" && page.lang === "vi")!;
const allSockets = new Set<WebSocket>();
let serverLog = "";
const serverEnvironment = { ...process.env, NODE_ENV: "production", HOSTNAME: "127.0.0.1", PORT: "3137", OPENAI_BASE_URL: "http://127.0.0.1:3138/v1", TRUSTED_PROXY_IPS: "", ALLOWED_ORIGINS: origin } satisfies NodeJS.ProcessEnv;
let child = startServer();
function startServer() {
  const serverProcess = spawn(process.execPath, [resolve("dist/server.cjs")], { env: serverEnvironment, stdio: ["ignore", "pipe", "pipe"] });
  serverProcess.stdout.on("data", (chunk) => { serverLog += String(chunk); });
  serverProcess.stderr.on("data", (chunk) => { serverLog += String(chunk); });
  return serverProcess;
}
async function waitFor(check: () => boolean | Promise<boolean>, label: string, timeout = 15000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(30); }
  throw new Error(`Timed out: ${label}`);
}
const health = async () => (await fetch(`${origin}/api/health`).catch(() => null))?.status === 200;
type TestRequestBody = Record<string, string | boolean | number | undefined>;
async function request(path: string, body?: TestRequestBody, cookie?: string, extraHeaders: Record<string, string> = {}) {
  const headers = new Headers({ origin, "content-type": "application/json", ...extraHeaders });
  if (cookie) headers.set("cookie", cookie);
  return fetch(`${origin}${path}`, { method: body === undefined ? "GET" : "POST", headers,
    body: body === undefined ? undefined : JSON.stringify(body) });
}
async function rawStatus(path: string, headers: Record<string, string>, chunks: string[] = []) {
  return new Promise<number>((resolve, reject) => {
    const outgoing = rawRequest(`${origin}${path}`, { method: chunks.length ? "POST" : "GET", headers: { origin, ...headers } }, (response) => {
      response.resume();
      resolve(response.statusCode ?? 0);
    });
    outgoing.on("error", reject);
    for (const chunk of chunks) outgoing.write(chunk);
    outgoing.end();
  });
}
async function connect(query: string, transcribe = false) {
  const ws = new WebSocket(`${origin.replace("http", "ws")}/ws${transcribe ? "/transcribe" : ""}?${query}`, { origin });
  allSockets.add(ws);
  ws.on("error", () => {});
  await new Promise<void>((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });
  return ws;
}
async function startVoice(clientId: string, token = input.token) {
  const ws = await connect(`token=${token}&clientId=${clientId}`, true);
  const ready = new Promise<{ t: string; leaseId: string }>((resolve) => {
    const receive = (raw: import("ws").RawData) => {
      const frame = JSON.parse(String(raw));
      if (frame.t !== "ready" && frame.t !== "error") return;
      ws.off("message", receive);
      resolve(frame);
    };
    ws.on("message", receive);
  });
  ws.send(JSON.stringify({ t: "start" }));
  return { ws, ready: await ready };
}

try {
  await waitFor(health, "server start");
  const login = await request("/api/admin/login", { password: process.env.ADMIN_PASSWORD });
  assert.equal(login.status, 200);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  const statsMessages: Array<{ t: string; snapshot: boolean; sessions: Array<{ meetingId: string; total: number; languages: Array<{ lang: string; output: number }> }> }> = [];
  const statsSocket = new WebSocket(`${origin.replace("http", "ws")}/ws?stats=1`, { origin, headers: { cookie } });
  allSockets.add(statsSocket);
  statsSocket.on("error", () => {});
  statsSocket.on("message", (raw) => {
    const frame = JSON.parse(String(raw));
    // The same admin socket also carries app-settings-changed notifications.
    if (frame.t === "connection-stats") statsMessages.push(frame);
  });
  await waitFor(() => statsMessages.some((frame) => frame.snapshot), "initial authenticated statistics");
  assert.equal(statsMessages[0].sessions.find((entry) => entry.meetingId === meeting.id)?.total, 0);
  const deniedStats = new WebSocket(`${origin.replace("http", "ws")}/ws?stats=1&token=${output.token}`, { origin });
  const deniedStatus = await new Promise<number>((resolve) => {
    deniedStats.on("unexpected-response", (_request, response) => { response.resume(); deniedStats.terminate(); resolve(response.statusCode ?? 0); });
    deniedStats.on("error", () => {});
  });
  assert.equal(deniedStatus, 401, "viewer tokens cannot subscribe to admin counts");
  assert.equal(/;\s*Secure/i.test(login.headers.get("set-cookie")!), false);
  const spoof = await request("/api/admin/login", { password: process.env.ADMIN_PASSWORD }, undefined, { "x-forwarded-proto": "https", "cf-connecting-ip": "8.8.8.8" });
  assert.equal(/;\s*Secure/i.test(spoof.headers.get("set-cookie")!), false);
  assert.equal((await request("/api/admin/security")).status, 401);
  assert.equal((await request("/api/meetings", {}, cookie, { origin: "https://evil.invalid" })).status, 403);
  assert.equal(await rawStatus("/api/health", { host: "evil.invalid" }), 403);
  assert.equal(await rawStatus("/api/admin/login", { "content-type": "application/json" }, ["{\"password\":\"", "x".repeat(40000), "x".repeat(40000), "\"}"]), 413);
  assert.equal((await request("/api/admin/login", { password: "x".repeat(70000) })).status, 413);
  assert.equal((await request("/api/admin/security", undefined, "lct_admin=%")).status, 401);
  const invalid = await fetch(`${origin}/api/pages/${input.token}/messages`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{" });
  assert.equal(invalid.status, 400);
  const oversizedWs = await connect(`token=${output.token}`);
  const oversizedClosed = new Promise<number>((resolve) => oversizedWs.once("close", resolve));
  oversizedWs.send("x".repeat(33000));
  assert.equal(await oversizedClosed, 1009);
  assert.equal(await health(), true);
  console.log("PASS HTTP/WS malformed input, origin, host, size and cookie boundaries");

  const first = await startVoice("participant-one");
  assert.equal(first.ready.t, "ready");
  const duplicate = await startVoice("participant-one");
  assert.equal(duplicate.ready.t, "error");
  const second = await startVoice("participant-two");
  assert.equal(second.ready.t, "ready");
  await waitFor(() => providerConnections === 2, "two independent microphones");
  const stopped = new Promise<void>((resolve) => first.ws.once("close", () => resolve()));
  assert.equal((await request(`/api/meetings/${meeting.id}/voice-status`, { participantId: "participant-one" }, cookie)).status, 200);
  await stopped;
  await waitFor(() => providerConnections === 1, "upstream forcibly stopped");
  const rejected = await request(`/api/pages/${input.token}/transcripts`, { leaseId: first.ready.leaseId, ingestKey: "stopped-transcript", body: "not allowed" });
  assert.equal(rejected.status, 409);
  second.ws.close();
  await waitFor(() => providerConnections === 0, "second microphone cleanup");
  console.log("PASS same-language participants, duplicate admission, forced server stop and late transcript rejection");

  let received = 0;
  const viewerCount = 4000;
  for (let batch = 0; batch < viewerCount / 100; batch++) {
    await Promise.all(Array.from({ length: 100 }, async () => {
      const ws = await connect(`token=${output.token}`);
      ws.on("message", (raw) => { if (JSON.parse(String(raw)).t === "translation") received++; });
    }));
  }
  const started = Date.now();
  await waitFor(() => statsMessages.some((frame) => frame.sessions.some((entry) => entry.meetingId === meeting.id && entry.total === viewerCount)), "4000 viewers in shared statistics");
  for (let index = 0; index < 10; index++) {
    const response = await request(`/api/pages/${input.token}/messages`, { body: `검증 문장 ${index}`, ingestKey: `load-message-${index}` });
    assert.equal(response.status, 201);
    await delay(Math.max(0, started + (index + 1) * 500 - Date.now()));
  }
  await waitFor(() => received === 40000, "4000 viewers receive ten translations", 20000);
  assert.equal(providerCalls, 10);
  const latestCounts = statsMessages.flatMap((frame) => frame.sessions).filter((entry) => entry.meetingId === meeting.id).at(-1)!;
  assert.equal(latestCounts.total, viewerCount, "admin statistics socket is not counted");
  assert.equal(latestCounts.languages.find((entry) => entry.lang === "vi")?.output, viewerCount);
  for (const ws of allSockets) if (ws.readyState === WebSocket.OPEN) ws.close();
  console.log("PASS authenticated live counts, 4000 viewers, 2 source messages/sec, 40000 delivered translations");

  const recovering = createMeeting();
  const recoveryInput = repo.getMeetingPages(recovering.id).find((page) => page.kind === "input" && page.lang === "ko")!;
  holdTranslations = true;
  translationGate = new Promise<void>((resolve) => { releaseTranslations = resolve; });
  const accepted = await request(`/api/pages/${recoveryInput.token}/messages`, { body: "재시작 후 복구", ingestKey: "durable-recovery-key" });
  assert.equal(accepted.status, 201);
  await waitFor(() => repo.getTranslationJobCounts(recovering.id).running === 1, "durable running job");
  assert.equal((await request(`/api/meetings/${recovering.id}`, {}, cookie)).status, 200);
  child.kill("SIGKILL");
  await new Promise((resolve) => child.once("exit", resolve));
  // Simulate expiry while the server was offline; no two-minute wall-clock wait is needed.
  repo.recoverTranslationJobs(Date.now() + 121000);
  holdTranslations = false;
  releaseTranslations();
  child = startServer();
  await waitFor(health, "server restart");
  await waitFor(() => repo.getRecentCombined(recovering.id)[0]?.translations.length === 1, "closed-session durable recovery");
  assert.deepEqual(repo.getTranslationJobCounts(recovering.id), { pending: 0, running: 0, failed: 0 });
  console.log("PASS process kill/restart recovery and accepted translations completing after session close");

  const rewriteMeeting = createMeeting();
  const rewriteInput = repo.getMeetingPages(rewriteMeeting.id).find((page) => page.kind === "input" && page.lang === "ko")!;
  const voice = await startVoice("rewrite-race-device", rewriteInput.token);
  assert.equal(voice.ready.t, "ready");
  holdRewrite = true;
  rewriteGate = new Promise<void>((resolve) => { releaseRewrite = resolve; });
  const submitted = request(`/api/pages/${rewriteInput.token}/transcripts`, { leaseId: voice.ready.leaseId, ingestKey: "rewrite-race-key", body: "보정 전 문장", rewrite: true });
  const combined = repo.getMeetingPages(rewriteMeeting.id).find((page) => page.kind === "combined-input")!;
  const detecting = request(`/api/pages/${combined.token}/messages`, { ingestKey: "detection-race-key", body: "hello there" });
  await delay(150);
  await request(`/api/meetings/${rewriteMeeting.id}`, {}, cookie);
  releaseRewrite();
  const late = await submitted;
  assert.equal(late.status, 409);
  assert.equal((await detecting).status, 409);
  assert.equal(repo.getRecentMessages(rewriteMeeting.id).length, 0);
  assert.equal(await health(), true);
  console.log("PASS session closure during asynchronous rewriting and detection leaves no source or translation job");

  const results = await Promise.all(Array.from({ length: 16 }, () => request("/api/admin/login", { password: "wrong-test-password" })));
  assert.ok(results.some((result) => result.status === 429));
  assert.equal(await health(), true);
  assert.equal((await request("/api/admin/login", { password: "wrong-test-password" })).status, 429);
  console.log("PASS bounded login attempts; server health remains available");
} catch (error) {
  console.error(serverLog.replace(/fake-security-test-key/g, "[test-key]"));
  throw error;
} finally {
  releaseTranslations();
  releaseRewrite();
  for (const ws of allSockets) ws.terminate();
  child.kill("SIGTERM");
  await new Promise((resolve) => { if (child.exitCode !== null || child.signalCode !== null) resolve(null); else child.once("exit", resolve); });
  for (const ws of providerWs.clients) ws.terminate();
  providerWs.close();
  provider.closeAllConnections();
  await new Promise<void>((resolve) => provider.close(() => resolve()));
  getDb().close();
  globalThis.__meetingDb = undefined;
  rmSync(directory, { recursive: true, force: true });
}
