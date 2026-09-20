import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { get } from "node:https";
import { BlockList, isIP } from "node:net";
import { devNull, tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocket } from "ws";
import { z } from "zod";
import { decryptSecret, encryptSecret } from "./crypto";
import { type DesktopAction, type DesktopState } from "./desktop-control";
import { serverControlEnvironment } from "./env";
import { getNamedTunnelSettings, setNamedTunnelSettings } from "./repo";
import { notifyAppSettings } from "./voice-settings";

const settingsSchema = z.object({
  mode: z.enum(["base", "named", "external"]).default("base"),
  origin: z.string().default(""), token: z.string().default(""), auto: z.boolean().default(false),
});
type Settings = z.infer<typeof settingsSchema>;
type Connector = { process: ChildProcess; ready: () => boolean; stop: () => void };
type Candidate = { id: string; settings: Settings; connector: Connector | null; expires: number };
declare global {
  var __liveConfTunnelProbe: { origin: string; key: string; answer: string; expires: number } | undefined;
}

const blocked = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24], ["224.0.0.0", 3],
] as const) blocked.addSubnet(address, prefix);
const globalV6 = new BlockList(); globalV6.addSubnet("2000::", 3, "ipv6");
blocked.addSubnet("2001::", 23, "ipv6"); blocked.addSubnet("2001:db8::", 32, "ipv6");
blocked.addSubnet("2002::", 16, "ipv6"); blocked.addSubnet("3fff::", 20, "ipv6");
export function publicTunnelAddress(address: string): boolean {
  return isIP(address) === 4 ? !blocked.check(address) : isIP(address) === 6 &&
    globalV6.check(address, "ipv6") && !blocked.check(address, "ipv6");
}
export function tunnelOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "/" ||
    url.search || url.hash || isIP(url.hostname.replace(/[[\]]/g, "")) || !url.hostname.includes(".") ||
    url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local") || url.hostname.endsWith(".")) throw new Error("tunnelInvalid");
  return url.origin;
}

/** Only a short-lived challenge can use the otherwise closed probe endpoints. */
export function tunnelProbeAnswer(host: string | undefined, key: string | string[] | undefined): string | null {
  const probe = globalThis.__liveConfTunnelProbe;
  return probe && probe.expires > Date.now() && new URL(probe.origin).host === host && key === probe.key ? probe.answer : null;
}

/** Pin a public DNS result for both transports; no redirects, cookies or provider token. */
export async function verifyTunnel(origin: string): Promise<void> {
  origin = tunnelOrigin(origin);
  const records = await lookup(new URL(origin).hostname, { all: true });
  if (!records.length || records.some(({ address }) => !publicTunnelAddress(address))) throw new Error("tunnelInvalid");
  const address = records.find((record) => record.family === 4) ?? records[0];
  const pinnedLookup: NonNullable<import("node:net").TcpNetConnectOpts["lookup"]> = (_host, options, callback) => {
    if (options.all) callback(null, [address]); else callback(null, address.address, address.family);
  };
  const probe = { origin, key: randomBytes(32).toString("hex"), answer: randomBytes(32).toString("hex"), expires: Date.now() + 15_000 };
  globalThis.__liveConfTunnelProbe = probe;
  const headers = { "x-tunnel-probe": probe.key, origin };
  try {
    await new Promise<void>((resolve, reject) => {
      const request = get(`${origin}/api/tunnel-probe`, { headers, lookup: pinnedLookup, agent: false, signal: AbortSignal.timeout(5000) }, (response) => {
        let body = "";
        response.on("data", (chunk: Buffer) => { body += chunk.toString(); if (body.length > 256) request.destroy(new Error("tunnelCheckFailed")); });
        response.on("error", reject);
        response.on("end", () => response.statusCode === 200 && body === probe.answer ? resolve() : reject(new Error("tunnelCheckFailed")));
      });
      request.on("error", reject);
    });
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${origin.replace(/^https:/, "wss:")}/ws/tunnel-probe`, {
        headers, lookup: pinnedLookup, handshakeTimeout: 5000, maxPayload: 256, followRedirects: false,
      });
      const timer = setTimeout(() => { ws.terminate(); reject(new Error("tunnelCheckFailed")); }, 5000);
      ws.once("message", (data) => {
        clearTimeout(timer); ws.close();
        if (data.toString() === probe.answer) resolve(); else reject(new Error("tunnelCheckFailed"));
      });
      ws.once("error", () => { clearTimeout(timer); reject(new Error("tunnelCheckFailed")); });
      ws.once("close", () => { clearTimeout(timer); reject(new Error("tunnelCheckFailed")); });
    });
  } finally { if (globalThis.__liveConfTunnelProbe === probe) globalThis.__liveConfTunnelProbe = undefined; }
}

export function launchNamedTunnel(token: string): Connector {
  // Never put the token in argv, log output, or a browser-readable state object.
  const directory = mkdtempSync(join(tmpdir(), "lct-tunnel-"));
  const file = join(directory, "token");
  const pidfile = join(directory, "connected.pid");
  try {
    writeFileSync(file, token, { mode: 0o600, flag: "wx" });
    const child = spawn(serverControlEnvironment().cloudflared, ["tunnel", "--config", devNull, "--no-autoupdate", "--protocol", "http2", "--pidfile", pidfile, "run", "--token-file", file], { windowsHide: true, stdio: "ignore" });
    const remove = () => rmSync(directory, { recursive: true, force: true });
    child.once("exit", remove); child.once("error", remove);
    return { process: child, ready: () => existsSync(pidfile), stop: () => { child.kill(); remove(); } };
  } catch { rmSync(directory, { recursive: true, force: true }); throw new Error("tunnelCheckFailed"); }
}

/** One implementation for the embedded Electron server and standalone Node. */
export function startNamedTunnelControl(verify = verifyTunnel, launch = launchNamedTunnel) {
  const existing = globalThis.__liveConfDesktopControl;
  if (!existing) return;
  const base = existing;
  const encrypted = getNamedTunnelSettings();
  const plain = encrypted ? decryptSecret(Buffer.from(encrypted, "base64")) : null;
  let settings = settingsSchema.parse(plain ? JSON.parse(plain) : {});
  let active: Connector | null = null;
  let pending: Candidate | null = null;
  let pendingTimer: ReturnType<typeof setTimeout> | undefined;
  let recovery: ReturnType<typeof setTimeout> | undefined;
  let busy = false, disposed = false;
  let stopPending = false;
  let checking: Connector | null = null;
  let state: DesktopState["tunnel"] = "off";
  const previousOrigins = globalThis.__liveConfAllowedOrigins;
  globalThis.__liveConfAllowedOrigins = () => [...(previousOrigins?.() ?? []),
    ...(settings.mode !== "base" && settings.origin ? [settings.origin] : []),
    ...(pending ? [pending.settings.origin] : []), ...(globalThis.__liveConfTunnelProbe ? [globalThis.__liveConfTunnelProbe.origin] : [])];
  const save = (next: Settings) => {
    setNamedTunnelSettings(Buffer.from(encryptSecret(JSON.stringify(next))).toString("base64")); settings = next;
  };
  const cancel = () => { const old = pending; pending = null; clearTimeout(pendingTimer); old?.connector?.stop(); notifyAppSettings(); };
  const schedule = () => {
    if (disposed || !settings.auto || settings.mode !== "named" || recovery || active) return;
    state = "recovering";
    recovery = setTimeout(() => { recovery = undefined; void restart(); }, 10_000);
    notifyAppSettings();
  };
  function watch(connector: Connector) {
    const gone = () => {
      if (pending?.connector === connector) cancel();
      if (active !== connector) return;
      active = null; state = "off"; schedule(); notifyAppSettings();
    };
    connector.process.once("exit", gone); connector.process.once("error", gone);
  }
  async function check(next: Settings): Promise<Candidate> {
    const connector = next.mode === "named" ? launch(next.token) : null;
    checking = connector;
    let exited = false;
    const gone = () => { exited = true; };
    connector?.process.once("exit", gone); connector?.process.once("error", gone);
    try {
      // cloudflared writes its pidfile only after its own first successful edge connection.
      // A healthy pre-existing connector must not validate a mistyped replacement token.
      for (let attempt = 0; connector && !connector.ready() && attempt < 20; attempt++) {
        if (disposed || exited) throw new Error("tunnelCheckFailed");
        await delay(1000);
      }
      if (connector && !connector.ready()) throw new Error("tunnelCheckFailed");
      // DNS/connector propagation may take a few seconds; old sharing remains untouched.
      for (let attempt = 0; attempt < 5; attempt++) {
        if (disposed || exited) throw new Error("tunnelCheckFailed");
        try {
          await verify(next.origin);
          if (disposed || exited) throw new Error("tunnelCheckFailed");
          return { id: randomUUID(), settings: next, connector, expires: Date.now() + 120_000 };
        } catch { if (attempt === 4) throw new Error("tunnelCheckFailed"); }
        await delay(1000);
      }
      throw new Error("tunnelCheckFailed");
    } catch { connector?.stop(); throw new Error("tunnelCheckFailed"); }
    finally { checking = null; connector?.process.removeListener("exit", gone); connector?.process.removeListener("error", gone); }
  }
  async function restart() {
    if (busy || disposed || settings.mode !== "named" || active) { schedule(); return; }
    busy = true; state = "connecting"; notifyAppSettings();
    try { const candidate = await check(settings); active = candidate.connector; if (active) watch(active); state = "connected"; base.notifyOrigin?.(settings.origin); }
    catch { state = "off"; schedule(); }
    finally { busy = false; notifyAppSettings(); }
  }
  async function run(action: DesktopAction): Promise<{ error?: string; link?: string }> {
    if (busy || stopPending) return { error: "busy" };
    busy = true;
    try {
      if (action.action === "tunnel-check") {
        cancel();
        const origin = tunnelOrigin(action.origin);
        const token = action.token || (origin === settings.origin ? settings.token : "");
        if (action.mode === "named" && !/^[A-Za-z0-9+/_=-]{40,4096}$/.test(token)) return { error: "tunnelInvalid" };
        // A second connector for the same tunnel is unnecessary and can race its existing instance.
        if (active && origin === settings.origin) return { error: "tunnelStopFirst" };
        pending = await check({ mode: action.mode, origin, token: action.mode === "named" ? token : "", auto: false });
        if (pending.connector) watch(pending.connector);
        pendingTimer = setTimeout(cancel, 120_000);
      } else if (action.action === "tunnel-apply") {
        if (!pending || pending.id !== action.id || pending.expires <= Date.now()) return { error: "tunnelCheckFailed" };
        const candidate = pending;
        await verify(candidate.settings.origin);
        if (pending !== candidate || candidate.expires <= Date.now()) return { error: "tunnelCheckFailed" };
        save(candidate.settings); // Persist before touching either current connection.
        const old = active; active = candidate.connector; pending = null; clearTimeout(pendingTimer); clearTimeout(recovery); recovery = undefined;
        state = "connected";
        if (old) setTimeout(() => old.stop(), 750);
        // Keep the original tunnel usable for already-open pages until it is explicitly stopped or the app exits.
        if (!base.snapshot().externalTunnel) await base.run({ action: "auto", enabled: false });
        base.notifyOrigin?.(settings.origin);
      } else if (action.action === "tunnel-cancel") cancel();
      else if (action.action === "tunnel-base") {
        save({ ...settings, mode: "base", auto: false }); cancel(); clearTimeout(recovery); recovery = undefined;
        const old = active; active = null; if (old) setTimeout(() => old.stop(), 750); state = "off";
      } else if (settings.mode !== "base" && ["start", "stop", "auto"].includes(action.action)) {
        if (settings.mode === "external") return { error: "genericError" };
        if (action.action === "auto") {
          save({ ...settings, auto: action.enabled }); clearTimeout(recovery); recovery = undefined;
          if (!action.enabled && state === "recovering") state = "off";
        }
        if (action.action === "stop") {
          save({ ...settings, auto: false }); clearTimeout(recovery); recovery = undefined;
          // Let the public HTTP response finish before ending this connector.
          stopPending = true;
          setTimeout(() => { const old = active; active = null; old?.stop(); state = "off"; stopPending = false; notifyAppSettings(); }, 750);
        } else if (!active && (action.action === "start" || settings.auto)) {
          const candidate = await check(settings); active = candidate.connector; if (active) watch(active); state = "connected";
          base.notifyOrigin?.(settings.origin);
        }
      } else return await base.run(action);
      return {};
    } catch (error) {
      schedule();
      return { error: error instanceof Error && error.message === "tunnelInvalid" ? "tunnelInvalid" : "tunnelCheckFailed" };
    } finally { busy = false; notifyAppSettings(); }
  }
  const snapshot = (): DesktopState => {
    const original = base.snapshot();
    const custom = settings.mode !== "base";
    const result: DesktopState = { ...original,
      connection: { mode: settings.mode !== "base" ? settings.mode : original.externalTunnel ? "external" : "quick",
        baseMode: original.externalTunnel ? "external" : "quick", configuredOrigin: settings.origin,
        hasToken: Boolean(settings.token), auto: custom ? settings.auto : original.telegram.autoTunnel, busy: busy || stopPending,
        pending: pending ? { id: pending.id, origin: pending.settings.origin, mode: pending.settings.mode === "named" ? "named" : "external", expires: pending.expires } : null },
    };
    if (custom) { result.origin = state === "connected" ? settings.origin : original.origin; result.tunnel = state; result.externalTunnel = settings.mode === "external"; }
    return result;
  };
  const control = { run, snapshot };
  globalThis.__liveConfDesktopControl = control;
  const cleanup = () => { disposed = true; cancel(); clearTimeout(recovery); checking?.stop(); active?.stop(); active = null; };
  process.once("exit", cleanup);
  if (settings.mode === "named" && settings.auto) void restart();
  if (settings.mode === "external") {
    busy = true;
    void verify(settings.origin).then(() => { if (!disposed) state = "connected"; }).catch(() => {}).finally(() => { busy = false; notifyAppSettings(); });
  }
  return { ...control, close: () => { cleanup(); process.removeListener("exit", cleanup); globalThis.__liveConfDesktopControl = base; globalThis.__liveConfAllowedOrigins = previousOrigins; } };
}
