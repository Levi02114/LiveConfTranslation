import type { IncomingMessage, ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";
import { isIP } from "node:net";
import { z } from "zod";
import { configuredOrigins, localHttpsPort, serverEnvironment, trustedProxyIps } from "@/lib/env";

const normalizeIp = (ip: string) => ip.replace(/^::ffff:/, "");

/** The custom server is the only writer of trusted request metadata. */
export function validateRequest(req: IncomingMessage, requireOrigin: boolean): boolean {
  const remote = normalizeIp(req.socket.remoteAddress ?? "");
  const trusted = trustedProxyIps().includes(remote);
  const forwardedProto = req.headers["x-forwarded-proto"];
  const forwardedIp = req.headers["cf-connecting-ip"] ?? req.headers["x-forwarded-for"];
  const scheme = "encrypted" in req.socket && req.socket.encrypted ? "https" :
    trusted && forwardedProto === "https" ? "https" : "http";
  for (const name of Object.keys(req.headers)) {
    if (name.startsWith("x-forwarded-") || name.startsWith("x-lct-") || name === "forwarded" || name === "cf-connecting-ip") delete req.headers[name];
  }
  const parsedIp = z.string().refine((value) => Boolean(isIP(value))).safeParse(forwardedIp);
  req.headers["x-lct-ip"] = trusted && parsedIp.success ? normalizeIp(parsedIp.data) : remote;
  req.headers["x-forwarded-proto"] = scheme;
  try {
    const host = req.headers.host;
    if (!host || /[\s/@\\,#?]/.test(host)) return false;
    const origin = new URL(`${scheme}://${host}`).origin;
    const allowed = new Set(configuredOrigins().map((value) => new URL(value).origin));
    const { port, hostname } = serverEnvironment();
    const hosts = new Set(["localhost", "127.0.0.1", "::1", hostname]);
    for (const entries of Object.values(networkInterfaces())) for (const entry of entries ?? []) hosts.add(entry.address);
    for (const address of hosts) {
      if (address === "0.0.0.0" || address === "::") continue;
      const host = address.includes(":") ? `[${address}]` : address;
      allowed.add(new URL(`http://${host}:${port}`).origin);
      allowed.add(new URL(`https://${host}:${localHttpsPort()}`).origin);
    }
    if (!allowed.has(origin)) return false;
    if (requireOrigin && req.headers.origin !== origin) return false;
    return true;
  } catch {
    return false;
  }
}

export function limitRequestBody(req: IncomingMessage, res: ServerResponse): boolean {
  const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  const limit = pathname === "/api/admin/glossary" ? 5 * 1024 * 1024 :
    pathname.startsWith("/api/admin/") && !["/api/admin/login", "/api/admin/password", "/api/admin/logout"].includes(pathname) ? 1024 * 1024 : 64 * 1024;
  const reject = () => {
    if (res.writableEnded) return;
    res.writeHead(413, { "content-type": "application/json", connection: "close" });
    res.end(JSON.stringify({ error: "payload-too-large" }));
    req.pause();
    res.once("finish", () => req.destroy());
  };
  if (Number(req.headers["content-length"] ?? 0) > limit) { reject(); return false; }
  let received = 0;
  const push = req.push;
  // Enforce before buffering without switching the request into flowing mode.
  req.push = (chunk, encoding) => {
    if (chunk !== null) received += Buffer.byteLength(chunk);
    if (received > limit) { reject(); return false; }
    return push.call(req, chunk, encoding);
  };
  return true;
}
