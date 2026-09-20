import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AudioTurnDetector } from "./audio-turn-detector";
import { parseServerMessage, parseVoiceEvent } from "./client-json";
import { desktopActionSchema, desktopTransportAllowed } from "./desktop-control";
import { DEFAULT_VOICE_SETTINGS, notifyAppSettings, silenceMsFor, subscribeAppSettings, voiceSettingsSchema } from "./voice-settings";

test("silence settings validate, snapshot at the next utterance, and retain the continuous-speech cap", () => {
  assert.equal(silenceMsFor(DEFAULT_VOICE_SETTINGS, ["ko", "th-TH"]), 1700);
  assert.equal(silenceMsFor(DEFAULT_VOICE_SETTINGS, ["ko", "vi"]), 1100);
  assert.equal(silenceMsFor({ mode: "manual", silenceMs: 500 }, ["si"]), 500);
  const perLanguage = voiceSettingsSchema.parse({ mode: "manual", silenceMs: 900, languages: {
    ko: { mode: "manual", silenceMs: 500 }, th: { mode: "manual", silenceMs: 2400 }, si: { mode: "auto", silenceMs: 1100 },
  } });
  assert.equal(silenceMsFor(perLanguage, ["ko"]), 500);
  assert.equal(silenceMsFor(perLanguage, ["th-TH"]), 2400);
  assert.equal(silenceMsFor(perLanguage, ["ko", "th"]), 2400);
  assert.equal(silenceMsFor(perLanguage, ["si"]), 1700);
  assert.equal(silenceMsFor(perLanguage, ["vi"]), 900, "existing global settings remain the fallback");
  assert.equal(silenceMsFor({ ...DEFAULT_VOICE_SETTINGS, languages: { "zh-CN": { mode: "manual", silenceMs: 800 } } }, ["zh-cn"]), 800);
  assert.deepEqual(parseVoiceEvent(JSON.stringify({ t: "voice-settings", settings: perLanguage })), { t: "voice-settings", settings: perLanguage });
  assert.equal(voiceSettingsSchema.safeParse({ ...perLanguage, languages: { ko: { mode: "manual", silenceMs: 50 } } }).success, false);
  for (const silenceMs of [0, 299, 301, 5001, NaN, Infinity]) assert.equal(voiceSettingsSchema.safeParse({ mode: "manual", silenceMs }).success, false);
  let silenceMs = 1100;
  const detector = new AudioTurnDetector(() => silenceMs);
  for (let i = 0; i < 40; i++) detector.calibrate(0.0005);
  assert.equal(detector.update(0.02, 0), false);
  silenceMs = 300;
  assert.equal(detector.update(0, 100), false);
  assert.equal(detector.phase(), "silence");
  assert.equal(detector.update(0, 400), false, "current utterance retains old delay");
  assert.equal(detector.update(0, 1200), true);
  detector.update(0.02, 1300); detector.update(0, 1400);
  assert.equal(detector.update(0, 1700), true, "next utterance uses new delay");
  detector.update(0.02, 2000);
  assert.equal(detector.update(0.02, 17000), true);
  assert.deepEqual(parseVoiceEvent(JSON.stringify({ t: "voice-settings", settings: DEFAULT_VOICE_SETTINGS })), { t: "voice-settings", settings: DEFAULT_VOICE_SETTINGS });
  assert.equal(parseVoiceEvent('{"t":"voice-settings","settings":{"mode":"manual","silenceMs":2}}'), null);
  assert.deepEqual(parseServerMessage('{"t":"app-settings-changed"}'), { t: "app-settings-changed" });
});

test("desktop writes reject unsafe transport, arbitrary commands and unconfirmed tunnel shutdown", () => {
  assert.equal(desktopTransportAllowed("http://127.0.0.1:3000", new Headers({ "x-lct-ip": "192.168.1.2" })), false);
  assert.equal(desktopTransportAllowed("http://192.168.1.1:3000", new Headers({ "x-lct-ip": "127.0.0.1" })), false);
  assert.equal(desktopTransportAllowed("http://127.0.0.1:3000", new Headers({ "x-lct-ip": "127.0.0.1" })), true);
  assert.equal(desktopTransportAllowed("http://public.example", new Headers({ "x-forwarded-proto": "https" })), true);
  for (const action of [{ action: "shell", command: "ignored" }, { action: "stop" }, { action: "start", command: "ignored" }, { action: "verify", token: "short" }]) assert.equal(desktopActionSchema.safeParse(action).success, false);
  assert.equal(desktopActionSchema.safeParse({ action: "stop", confirmed: true }).success, true);
});

test("voice settings persist without sessions; changes notify and phrases support manual overlays", async () => {
  const directory = mkdtempSync(join(tmpdir(), "lct-voice-settings-"));
  const previous = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = join(directory, "test.db");
  const repo = await import("./repo");
  const { getDb } = await import("./db");
  const i18n = await import("./i18n");
  let notifications = 0;
  const unsubscribe = subscribeAppSettings(() => notifications++);
  try {
    assert.deepEqual(repo.getVoiceSettings(), DEFAULT_VOICE_SETTINGS);
    repo.setVoiceSettings({ mode: "manual", silenceMs: 2300 });
    getDb().close(); globalThis.__meetingDb = undefined;
    assert.deepEqual(repo.getVoiceSettings(), { mode: "manual", silenceMs: 2300 });
    const settings = { ...DEFAULT_VOICE_SETTINGS, languages: { ko: { mode: "manual" as const, silenceMs: 500 }, th: { mode: "manual" as const, silenceMs: 2400 } } };
    repo.setVoiceSettings(settings);
    getDb().close(); globalThis.__meetingDb = undefined;
    assert.deepEqual(repo.getVoiceSettings(), settings);
    assert.equal(repo.listMeetings().length, 0);
    notifyAppSettings(); assert.equal(notifications, 1);
    unsubscribe(); notifyAppSettings(); assert.equal(notifications, 1);
    for (const lang of ["ko", "vi", "th", "si"]) assert.ok(i18n.getAdminStrings(lang).appSettings.paidWarning);
    assert.ok(i18n.sourceEntries().some((row) => row.key === "admin.appSettings.delay"));
    assert.ok(i18n.sourceEntries().some((row) => row.key === "admin.appSettings.perLanguage"));
    repo.upsertUiStrings("vi", [{ key: "admin.appSettings.title", text: "Manual settings", origin: "manual" }]);
    assert.equal(i18n.getAdminStrings("vi").appSettings.title, "Manual settings");
  } finally {
    unsubscribe(); getDb().close(); globalThis.__meetingDb = undefined;
    if (previous === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
