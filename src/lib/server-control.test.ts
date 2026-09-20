import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startServerControl } from "./server-control";
import { getDb } from "./db";
import { getServerControlSettings, listMeetings } from "./repo";

test("standalone settings support encrypted Telegram credentials and sharing without Electron; external tunnels remain untouched", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "lct-server-control-"));
  const previous = { DATABASE_PATH: process.env.DATABASE_PATH, SESSION_SECRET: process.env.SESSION_SECRET, SERVER_PUBLIC_ORIGIN: process.env.SERVER_PUBLIC_ORIGIN };
  Object.assign(process.env, { DATABASE_PATH: join(directory, "test.db"), SESSION_SECRET: "test-only-server-settings-secret", SERVER_PUBLIC_ORIGIN: "https://preview.example" });
  const token = "123456789:FAKE_test_only_not_a_real_token";
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/getMe")) return Response.json({ ok: true, result: { id: 123456789, is_bot: true, username: "test_bot", first_name: "Test" } });
    if (url.endsWith("/getWebhookInfo")) return Response.json({ ok: true, result: { url: "https://webhook.example" } });
    throw new Error("Unexpected network call");
  });
  let runtime = startServerControl();
  try {
    assert.ok(runtime);
    assert.equal(runtime.snapshot().externalTunnel, true);
    assert.equal(runtime.snapshot().origin, "https://preview.example");
    assert.deepEqual(await runtime.run({ action: "share", origin: "https://arbitrary.example" }), { error: "genericError" });
    assert.deepEqual(await runtime.run({ action: "share", origin: runtime.snapshot().addresses[0].origin }), {});
    assert.equal(runtime.snapshot().origin, "https://preview.example", "public address keeps priority");
    assert.deepEqual(await runtime.run({ action: "stop", confirmed: true }), { error: "genericError" });
    assert.deepEqual(await runtime.run({ action: "verify", token }), {});
    assert.equal(runtime.snapshot().telegram.bot?.username, "test_bot");
    assert.equal(JSON.stringify(runtime.snapshot()).includes(token), false);
    assert.equal(getServerControlSettings()!.includes(token), false);
    runtime.close(); getDb().close(); globalThis.__meetingDb = undefined;
    runtime = startServerControl();
    assert.equal(runtime!.snapshot().telegram.bot?.username, "test_bot", "settings survive reopening the database");
    assert.equal(listMeetings().length, 0);
  } finally {
    runtime?.close(); getDb().close(); globalThis.__meetingDb = undefined;
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
    rmSync(directory, { recursive: true, force: true });
  }
});
