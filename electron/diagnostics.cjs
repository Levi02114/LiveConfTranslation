/* eslint-disable @typescript-eslint/no-require-imports */
// Serialization boundary: validate scalar metadata before writing it.
/* oxlint-disable anti-slop/no-runtime-typeof */
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");
const syncFs = require("node:fs");

const SLOT = Symbol.for("live-conf-translation.diagnostics");
const RETENTION_MS = 48 * 60 * 60 * 1000;
const MAX_BYTES = 50 * 1024 * 1024;
const SEGMENT_BYTES = 2 * 1024 * 1024;
const QUEUE_BYTES = 256 * 1024;
const FILE = /^lct-(\d{13})-\d+-[a-f0-9]{8}-\d+\.jsonl$/;
const numeric = new Set(["status", "durationMs", "count", "bytes", "attempt", "jobId", "messageId", "exitCode", "line", "column", "port", "dropped", "voiceRun", "sequence", "controlIndex", "dialogCount"]);
const labels = new Set(["action", "state", "mode", "provider", "phase", "reason", "code", "method", "errorType", "buildId", "serverBuildId", "version", "runtime", "from", "to", "activeTag", "targetTag"]);
const ids = new Set(["requestId", "connectionId", "meetingId", "pageId"]);

/** Only known metadata survives. Never serialize request bodies, Error.message/stack or credentials. */
function safeFields(fields = {}) {
  const result = {};
  for (const [key, value] of Object.entries(fields)) {
    if (numeric.has(key) && typeof value === "number" && Number.isFinite(value)) result[key] = value;
    else if (labels.has(key) && typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,80}$/.test(value) && !/^(sk-|Bearer)/i.test(value)) result[key] = value;
    else if (ids.has(key) && typeof value === "string" && /^[a-f0-9-]{36}$/i.test(value)) result[key] = value;
    else if (key === "route" && typeof value === "string") result.route = safeRoute(value);
    else if (["enabled", "reused", "packaged", "okay", "focused", "visible", "disabled", "activeDisabled"].includes(key) && typeof value === "boolean") result[key] = value;
  }
  return result;
}

function safeRoute(value) {
  const pathname = String(value).split(/[?#]/, 1)[0];
  if (pathname.startsWith("/_next/static/")) return "/_next/static/:asset";
  const page = /^\/api\/pages\/[^/]+(\/(?:messages|transcripts))?(\/[^/]+)?$/.exec(pathname);
  if (page) return `/api/pages/:token${page[1] || ""}${page[2] ? "/:id" : ""}`;
  if (/^\/(?:in(?:\/all)?|out|all|capture|join(?:\/input)?)\/[^/]+\/?$/.test(pathname)) return pathname.replace(/\/[^/]+\/?$/, "/:token");
  const meeting = /^(\/(?:api|admin)\/meetings)\/[^/]+(\/(?:config|log|voice-status|translation-jobs|transcription-context))?$/.exec(pathname);
  if (meeting) return `${meeting[1]}/:id${meeting[2] || ""}`;
  if (/^\/api\/admin\/(?:desktop|engine-keys|engine-settings|glossary|google-speech|languages|login|logout|openai-models|openai-usage|password|security|session-presets|ui-strings|voice-settings|voice-test)$/.test(pathname)) return pathname;
  return ["/", "/admin", "/admin/login", "/admin/site-management", "/api/meetings", "/api/health", "/api/tunnel-probe", "/api/diagnostics/client", "/ws", "/ws/transcribe", "/ws/tunnel-probe", "/local-ca.cer"].includes(pathname) ? pathname : "/:other";
}

function errorFields(error) {
  const name = error instanceof Error ? error.name : "UnknownError";
  const code = error && typeof error.code === "string" ? error.code : "";
  return { errorType: ["Error", "TypeError", "RangeError", "SyntaxError", "AbortError", "TimeoutError", "TranslationError"].includes(name) ? name : "Error",
    code: /^(?:E[A-Z0-9_]{2,30}|ERR_[A-Z0-9_]{1,50}|SQLITE_[A-Z_]{1,40}|(?:translation|provider|openai|google|deepl|engine|local)-[a-z-]{1,40})$/.test(code) ? code : "unspecified" };
}

function createLogger(directory, { now = Date.now, maxBytes = MAX_BYTES } = {}) {
  let pending = "", pendingBytes = 0, dropped = 0, sequence = 0, current = "", currentBytes = 0, bucket = -1;
  let lastPrune = -Infinity, totalBytes = 0, closed = false, warned = false;
  let work = Promise.resolve();
  const run = randomUUID().replaceAll("-", "").slice(0, 8);
  const context = new AsyncLocalStorage();
  async function prune() {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      const match = FILE.exec(entry.name);
      if (!match || !entry.isFile()) continue;
      const file = path.join(directory, entry.name);
      try { files.push({ file, time: Number(match[1]), size: (await fs.lstat(file)).size }); } catch { /* Another process may already have pruned it. */ }
    }
    files.sort((a, b) => a.time - b.time || a.file.localeCompare(b.file));
    let total = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files) {
      if (file.time >= now() - RETENTION_MS && total <= maxBytes) continue;
      await fs.unlink(file.file).catch(() => {});
      total -= file.size;
      if (file.file === current) { current = ""; currentBytes = 0; }
    }
    totalBytes = total;
    lastPrune = now();
  }
  function log(level, event, fields = {}) {
    if (closed || !["info", "warn", "error"].includes(level) || !/^[a-z][a-z0-9.-]{0,79}$/.test(event)) return;
    const line = JSON.stringify({ time: new Date(now()).toISOString(), pid: process.pid, run, level, event,
      ...safeFields(context.getStore()), ...safeFields(fields) }) + "\n";
    const size = Buffer.byteLength(line);
    if (pendingBytes + size > QUEUE_BYTES) { dropped++; return; }
    pending += line; pendingBytes += size;
  }
  function flush() {
    // One bounded batch in memory; slow disks cannot accumulate an unbounded promise chain.
    if (flushing) return work;
    flushing = true;
    const batch = pending; pending = ""; pendingBytes = 0;
    const lost = dropped; dropped = 0;
    work = (async () => {
      try {
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        const minute = Math.floor(now() / 60000) * 60000;
        let rotated = false;
        if (batch || lost) {
          if (!current || minute !== bucket || currentBytes + Buffer.byteLength(batch) > SEGMENT_BYTES) {
            bucket = minute; currentBytes = 0; rotated = true;
            current = path.join(directory, `lct-${minute}-${process.pid}-${run}-${sequence++}.jsonl`);
          }
          const overflow = lost ? JSON.stringify({ time: new Date(now()).toISOString(), pid: process.pid, run, level: "warn", event: "diagnostics.dropped", dropped: lost }) + "\n" : "";
          await fs.appendFile(current, batch + overflow, { mode: 0o600 });
          currentBytes += Buffer.byteLength(batch + overflow);
          totalBytes += Buffer.byteLength(batch + overflow);
        }
        if (rotated || totalBytes > maxBytes || now() - lastPrune >= 60000) await prune();
        warned = false;
      } catch {
        // Diagnostics must never prevent sessions from running, nor print the sensitive failing path.
        if (!warned) process.stderr.write("[diagnostics] file logging unavailable; retrying in background\n");
        warned = true;
      } finally { flushing = false; }
    })();
    return work;
  }
  let flushing = false;
  const timer = setInterval(() => { void flush(); }, 1000);
  timer.unref();
  void flush();
  function finalWrite(event, fields) {
    try {
      syncFs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const file = path.join(directory, `lct-${Math.floor(now() / 60000) * 60000}-${process.pid}-${run}-${sequence++}.jsonl`);
      syncFs.writeFileSync(file, pending + JSON.stringify({ time: new Date(now()).toISOString(), pid: process.pid, run, level: event === "process.exit" && fields.exitCode === 0 ? "info" : "error", event, ...safeFields(fields) }) + "\n", { mode: 0o600, flag: "wx" });
      pending = ""; pendingBytes = 0;
    } catch { /* Preserve the original exit/crash semantics even when disk writes fail. */ }
  }
  return { log, flush, context, finalWrite, close: async () => { clearInterval(timer); closed = true; await work; await flush(); } };
}

function initializeDiagnostics(directory) {
  if (!globalThis[SLOT]) {
    globalThis[SLOT] = createLogger(directory);
    process.once("uncaughtExceptionMonitor", (error) => globalThis[SLOT].finalWrite("process.uncaught", errorFields(error)));
    process.once("exit", (exitCode) => globalThis[SLOT].finalWrite("process.exit", { exitCode }));
  }
  return globalThis[SLOT];
}
function log(level, event, fields) { globalThis[SLOT]?.log(level, event, fields); }
function withContext(fields, callback) { return globalThis[SLOT] ? globalThis[SLOT].context.run(safeFields(fields), callback) : callback(); }
function flushDiagnostics() { return globalThis[SLOT]?.flush() ?? Promise.resolve(); }
module.exports = { createLogger, initializeDiagnostics, log, withContext, flushDiagnostics, safeRoute, safeFields, errorFields };
