import assert from "node:assert/strict";
import childProcess, { ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { desktopActionSchema, type DesktopState } from "./desktop-control";
import { getDb } from "./db";
import { getNamedTunnelSettings, upsertUiStrings } from "./repo";
import { getAdminStrings, sourceEntries, resolveEntries } from "./i18n-resolver";
import { launchNamedTunnel, publicTunnelAddress, startNamedTunnelControl, tunnelOrigin, tunnelProbeAnswer } from "./named-tunnel";

test("cloudflared receives a private token file, never a token argument or captured logs", (t) => {
  let file = "";
  const secret = "FAKE_test_only_not_a_real_cloudflare_token";
  t.mock.method(childProcess, "spawn", (_binary: string, args: string[], options: { stdio: string }) => {
    file = args[args.indexOf("--token-file") + 1];
    assert.ok(file);
    assert.ok(args.includes("--pidfile"));
    assert.equal(args.includes(secret), false);
    assert.equal(options.stdio, "ignore");
    assert.equal(readFileSync(file, "utf8"), secret);
    if (process.platform !== "win32") assert.equal(statSync(file).mode & 0o777, 0o600);
    return new ChildProcess();
  });
  const connector = launchNamedTunnel(secret);
  assert.equal(connector.ready(), false, "process creation alone does not mean the connector authenticated");
  connector.process.emit("exit", 0, null);
  assert.equal(existsSync(file), false);
  connector.stop();
});

test("fixed tunnel validation rejects private addresses, paths, unsafe actions and expired probes", () => {
  for (const value of ["http://example.com", "https://localhost", "https://example.com/path", "https://user:pass@example.com", "https://example.com:3000", "https://127.0.0.1", "https://[::1]", "https://x.local", "https://example.com?token=x"]) {
    assert.throws(() => tunnelOrigin(value));
  }
  assert.equal(tunnelOrigin("https://Translate.Example.com/"), "https://translate.example.com");
  for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "100.64.0.1", "192.168.1.2", "224.1.1.1", "::1", "::ffff:127.0.0.1", "fc00::1", "2001:db8::1", "2002:7f00:1::1"]) assert.equal(publicTunnelAddress(ip), false, ip);
  for (const ip of ["1.1.1.1", "104.16.0.1", "2606:4700::1111"]) assert.equal(publicTunnelAddress(ip), true, ip);
  assert.equal(desktopActionSchema.safeParse({ action: "tunnel-apply", id: "wrong", confirmed: true }).success, false);
  assert.equal(desktopActionSchema.safeParse({ action: "tunnel-base" }).success, false);
  globalThis.__liveConfTunnelProbe = { origin: "https://translate.example.com", key: "request-secret", answer: "independent-response", expires: Date.now() + 1000 };
  assert.equal(tunnelProbeAnswer("translate.example.com", "request-secret"), "independent-response");
  assert.equal(tunnelProbeAnswer("other.example.com", "request-secret"), null);
  assert.equal(tunnelProbeAnswer("translate.example.com", "wrong"), null);
  globalThis.__liveConfTunnelProbe.expires = 0;
  assert.equal(tunnelProbeAnswer("translate.example.com", "request-secret"), null);
  globalThis.__liveConfTunnelProbe = undefined;
});

test("named and external connection checks preserve the current URL, require apply, encrypt tokens and share localization", async () => {
  const directory = mkdtempSync(join(tmpdir(), "lct-named-test-"));
  const previousEnv = { DATABASE_PATH: process.env.DATABASE_PATH, SESSION_SECRET: process.env.SESSION_SECRET };
  Object.assign(process.env, { DATABASE_PATH: join(directory, "test.db"), SESSION_SECRET: "test-only-named-tunnel-secret" });
  const oldControl = globalThis.__liveConfDesktopControl;
  const oldOrigins = globalThis.__liveConfAllowedOrigins;
  const state: DesktopState = { origin: "https://old.example.com", tunnel: "connected", externalTunnel: true, ca: false,
    addresses: [{ origin: "http://127.0.0.1:3000", label: "localhost" }], telegram: { bot: null, chats: [], autoTunnel: false, receiver: "off" } };
  let baseCalls = 0, checks = 0, fail = false;
  const notifications: string[] = [];
  globalThis.__liveConfDesktopControl = { snapshot: () => state, run: async () => { baseCalls++; return {}; }, notifyOrigin: (origin) => { notifications.push(origin); } };
  globalThis.__liveConfAllowedOrigins = () => [state.origin];
  const processes: { process: ChildProcess; stopped: boolean; stop: () => void }[] = [];
  const token = "FAKE_test_only_tunnel_token_never_a_real_credential_123456";
  const launch = (value: string) => {
    assert.equal(value, token);
    const connector = { process: new ChildProcess(), ready: () => true, stopped: false, stop() { this.stopped = true; this.process.emit("exit", 0, null); } };
    processes.push(connector); return connector;
  };
  const verify = async () => { checks++; if (fail) throw new Error("secret-provider-error-must-not-be-returned"); };
  let runtime = startNamedTunnelControl(verify, launch);
  try {
    assert.ok(runtime);
    assert.deepEqual(await runtime.run({ action: "tunnel-check", mode: "named", origin: "https://translate.example.com", token }), {});
    assert.equal(runtime.snapshot().origin, state.origin);
    assert.equal(getNamedTunnelSettings(), null, "check alone does not persist credentials");
    assert.equal(JSON.stringify(runtime.snapshot()).includes(token), false);
    assert.ok(globalThis.__liveConfAllowedOrigins?.().includes("https://translate.example.com"));
    const first = runtime.snapshot().connection!.pending!;
    assert.deepEqual(await runtime.run({ action: "tunnel-apply", id: "00000000-0000-4000-8000-000000000000", confirmed: true }), { error: "tunnelCheckFailed" });
    assert.deepEqual(await runtime.run({ action: "tunnel-cancel" }), {});
    assert.equal(processes[0].stopped, true);
    assert.equal(runtime.snapshot().origin, state.origin);
    assert.deepEqual(await runtime.run({ action: "tunnel-apply", id: first.id, confirmed: true }), { error: "tunnelCheckFailed" });
    fail = true;
    assert.deepEqual(await runtime.run({ action: "tunnel-check", mode: "named", origin: "https://bad.example.com", token }), { error: "tunnelCheckFailed" });
    assert.equal(runtime.snapshot().origin, state.origin);
    assert.equal(processes[1].stopped, true);
    fail = false;
    await runtime.run({ action: "tunnel-check", mode: "named", origin: "https://translate.example.com", token });
    const pending = runtime.snapshot().connection!.pending!;
    assert.deepEqual(await runtime.run({ action: "tunnel-apply", id: pending.id, confirmed: true }), {});
    assert.equal(runtime.snapshot().origin, pending.origin);
    assert.equal(runtime.snapshot().connection!.mode, "named");
    assert.equal(runtime.snapshot().externalTunnel, false);
    assert.equal(getNamedTunnelSettings()!.includes(token), false);
    assert.equal(baseCalls, 0, "externally owned process is never stopped or modified");
    assert.deepEqual(notifications, [pending.origin]);
    assert.deepEqual(await runtime.run({ action: "auto", enabled: true }), {}, "named auto mode does not require Telegram");
    processes.at(-1)!.process.emit("exit", 1, null);
    assert.equal(runtime.snapshot().tunnel, "recovering");
    await runtime.run({ action: "auto", enabled: false });
    assert.equal(runtime.snapshot().tunnel, "off", "disabling recovery allows a manual restart");
    runtime.close();
    runtime = startNamedTunnelControl(verify, launch)!;
    assert.equal(runtime.snapshot().connection!.hasToken, true);
    assert.equal(runtime.snapshot().connection!.mode, "named");
    assert.equal(runtime.snapshot().tunnel, "off", "disabled auto mode stays stopped after restart");
    assert.deepEqual(await runtime.run({ action: "start" }), {});
    assert.equal(runtime.snapshot().origin, pending.origin);
    await runtime.run({ action: "auto", enabled: true });
    runtime.close();
    runtime = startNamedTunnelControl(verify, launch)!;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(runtime.snapshot().tunnel, "connected", "enabled auto mode restores the saved fixed tunnel on startup");
    assert.deepEqual(await runtime.run({ action: "stop", confirmed: true }), {});
    assert.deepEqual(await runtime.run({ action: "start" }), { error: "busy" }, "delayed stop cannot kill a replacement connector");
    await new Promise((resolve) => setTimeout(resolve, 800));
    assert.equal(runtime.snapshot().tunnel, "off");
    const count = processes.length;
    await runtime.run({ action: "tunnel-check", mode: "external", origin: "https://external.example.com" });
    assert.equal(processes.length, count, "external mode does not spawn cloudflared");
    await runtime.run({ action: "tunnel-apply", id: runtime.snapshot().connection!.pending!.id, confirmed: true });
    assert.equal(runtime.snapshot().origin, "https://external.example.com");
    assert.equal(runtime.snapshot().externalTunnel, true);
    assert.deepEqual(await runtime.run({ action: "stop", confirmed: true }), { error: "genericError" });
    await runtime.run({ action: "tunnel-base", confirmed: true });
    assert.equal(runtime.snapshot().origin, state.origin);
    assert.ok(checks >= 10);
    const entries = sourceEntries().filter((entry) => entry.key.startsWith("admin.tunnel."));
    assert.ok(entries.length >= 18);
    for (const lang of ["ko", "vi", "th", "si", "en", "zh-CN", "fil"]) {
      assert.ok(getAdminStrings(lang).tunnel.apply);
      assert.equal(resolveEntries(lang).filter((entry) => entry.key.startsWith("admin.tunnel.") && entry.origin !== "builtin").length, 0);
    }
    upsertUiStrings("ko", [{ key: "admin.tunnel.apply", text: "My custom label", origin: "manual" }]);
    assert.equal(getAdminStrings("ko").tunnel.apply, "My custom label");
  } finally {
    runtime?.close(); globalThis.__liveConfDesktopControl = oldControl; globalThis.__liveConfAllowedOrigins = oldOrigins;
    getDb().close(); globalThis.__meetingDb = undefined;
    for (const [key, value] of Object.entries(previousEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    rmSync(directory, { recursive: true, force: true });
  }
});
