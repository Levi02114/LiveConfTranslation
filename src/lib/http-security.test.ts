import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import test from "node:test";
import { z } from "zod";
import { validateRequest } from "./http-security";

test("only explicitly trusted proxy connections can supply the scheme and client IP", async () => {
  const previousOrigins = process.env.ALLOWED_ORIGINS;
  const previousProxies = process.env.TRUSTED_PROXY_IPS;
  const server = createServer((incoming, outgoing) => {
    outgoing.end(JSON.stringify({ valid: validateRequest(incoming, true), scheme: incoming.headers["x-forwarded-proto"], ip: incoming.headers["x-lct-ip"], forwardedHost: incoming.headers["x-forwarded-host"] ?? null }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = z.object({ port: z.number() }).parse(server.address());
  const origin = `http://127.0.0.1:${address.port}`;
  process.env.ALLOWED_ORIGINS = `${origin},${origin.replace("http", "https")}`;
  process.env.TRUSTED_PROXY_IPS = "";
  const probe = (secure = false) => new Promise<string>((resolve, reject) => {
    const call = request(origin, { headers: {
      origin: secure ? origin.replace("http", "https") : origin,
      "x-forwarded-proto": "https", "x-forwarded-host": "evil.invalid", "cf-connecting-ip": "8.8.8.8", "x-lct-ip": "attacker",
    } }, (response) => {
      let body = "";
      response.on("data", (chunk) => { body += String(chunk); });
      response.on("end", () => resolve(body));
    });
    call.on("error", reject);
    call.end();
  });
  try {
    assert.deepEqual(JSON.parse(await probe()), { valid: true, scheme: "http", ip: "127.0.0.1", forwardedHost: null });
    assert.equal(JSON.parse(await probe(true)).valid, false);
    process.env.TRUSTED_PROXY_IPS = "127.0.0.1";
    assert.deepEqual(JSON.parse(await probe(true)), { valid: true, scheme: "https", ip: "8.8.8.8", forwardedHost: null });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousOrigins === undefined) delete process.env.ALLOWED_ORIGINS; else process.env.ALLOWED_ORIGINS = previousOrigins;
    if (previousProxies === undefined) delete process.env.TRUSTED_PROXY_IPS; else process.env.TRUSTED_PROXY_IPS = previousProxies;
  }
});
