// Run after npm run build. Real Next routing, isolated DB, loopback listener only.
import assert from "node:assert/strict";
import { createServer, request as httpRequest } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import next from "next";
import { validateRequest } from "../src/lib/http-security";
import { getDb } from "../src/lib/db";

const directory = mkdtempSync(join(tmpdir(), "lct-desktop-transport-"));
const origin = "http://127.0.0.1:3193";
Object.assign(process.env, { NODE_ENV: "production", HOSTNAME: "0.0.0.0", PORT: "3193",
  DATABASE_PATH: join(directory, "test.db"), SESSION_SECRET: "transport-smoke-test-only-secret",
  ADMIN_PASSWORD: "transport-smoke-test-only-password", TRUSTED_PROXY_IPS: "127.0.0.1",
  ALLOWED_ORIGINS: "http://192.0.2.10:3193,https://public.example" });
let writes = 0;
globalThis.__liveConfDesktopControl = {
  snapshot: () => ({ origin, addresses: [{ origin, label: "localhost" }], tunnel: "off", ca: false,
    telegram: { bot: null, chats: [], autoTunnel: false, receiver: "off" } }),
  run: async () => { writes++; return {}; },
};
const app = next({ dev: false, hostname: "0.0.0.0", port: 3193, dir: process.cwd() });
await app.prepare();
const handle = app.getRequestHandler();
const server = createServer((request, response) => {
  if (!validateRequest(request, request.method === "POST")) { response.writeHead(403); response.end(); return; }
  void handle(request, response);
});
await new Promise<void>((resolve) => server.listen(3193, "127.0.0.1", resolve));
try {
  const login = await fetch(`${origin}/api/admin/login`, { method: "POST", headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
  // node:http preserves the explicit Host used to exercise LAN/proxy requests.
  const probe = (headers: Record<string, string>, method = "GET") => new Promise<Response>((resolve, reject) => {
    const call = httpRequest(`${origin}/api/admin/desktop`, { method, headers: { cookie, origin, "content-type": "application/json", ...headers } }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += String(chunk); });
      response.on("end", () => resolve(new Response(body, { status: response.statusCode })));
      response.on("error", reject);
    });
    call.on("error", reject);
    call.end(method === "POST" ? JSON.stringify({ action: "share", origin }) : undefined);
  });
  assert.equal((await (await probe({})).json()).writable, true, "Electron loopback GET must enable controls");
  assert.equal((await probe({}, "POST")).status, 200, "Electron loopback POST must reach the control bridge");
  assert.equal(writes, 1);
  const remote = { "cf-connecting-ip": "192.168.1.2", "x-lct-ip": "127.0.0.1" };
  assert.equal((await (await probe(remote)).json()).writable, false, "forwarded remote IP is not loopback");
  assert.equal((await probe(remote, "POST")).status, 403, "remote HTTP cannot spoof loopback metadata");
  const lan = { host: "192.0.2.10:3193", origin: "http://192.0.2.10:3193" };
  assert.equal((await (await probe(lan)).json()).writable, false, "LAN Host must be read-only");
  assert.equal((await probe(lan, "POST")).status, 403, "LAN Host is not localhost even from a loopback proxy");
  const https = { host: "public.example", origin: "https://public.example", "x-forwarded-proto": "https", "cf-connecting-ip": "8.8.8.8" };
  assert.equal((await (await probe(https)).json()).writable, true);
  assert.equal((await probe(https, "POST")).status, 200);
  assert.equal(writes, 2);
  assert.equal((await probe({ cookie: "" })).status, 401);
  assert.equal((await probe({ cookie: "" }, "POST")).status, 401);
  console.log("PASS Next bind-host rewrite: local GET/POST allowed; remote HTTP and spoofing blocked; trusted HTTPS allowed; authentication retained");
} catch (error) {
  process.exitCode = 1; // Next installs an uncaught-exception handler; keep failures nonzero.
  throw error;
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await app.close();
  getDb().close(); globalThis.__meetingDb = undefined;
  globalThis.__liveConfDesktopControl = undefined;
  rmSync(directory, { recursive: true, force: true });
}
