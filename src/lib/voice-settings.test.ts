import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { AudioTurnDetector } from "./audio-turn-detector";
import { parseServerMessage, parseVoiceEvent } from "./client-json";
import { desktopActionSchema, desktopTransportAllowed } from "./desktop-control";
import { DEFAULT_VOICE_SETTINGS, notifyAppSettings, silenceMsFor, subscribeAppSettings, voiceSettingsSchema, type VoiceSettings } from "./voice-settings";

test("silence settings validate, snapshot at the next utterance, and retain the continuous-speech cap", () => {
  assert.equal(silenceMsFor(DEFAULT_VOICE_SETTINGS, ["ko", "th-TH"]), 1700);
  assert.equal(silenceMsFor(DEFAULT_VOICE_SETTINGS, ["ko", "vi"]), 1100);
  assert.equal(silenceMsFor({ ...DEFAULT_VOICE_SETTINGS, mode: "manual", silenceMs: 500 }, ["si"]), 500);
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
  const legacy = { mode: "manual", silenceMs: 900, languages: { ko: { mode: "manual", silenceMs: 500 } } };
  const migrated = voiceSettingsSchema.parse(legacy);
  assert.deepEqual(migrated, { ...DEFAULT_VOICE_SETTINGS, ...legacy });
  assert.deepEqual(parseVoiceEvent(JSON.stringify({ t: "voice-settings", settings: legacy })), { t: "voice-settings", settings: migrated });
  for (const maxTurnMs of [5000, 15000, 30000]) {
    const settings: VoiceSettings = { ...migrated, maxTurnMs };
    assert.deepEqual(voiceSettingsSchema.parse(settings), settings);
    assert.deepEqual(parseVoiceEvent(JSON.stringify({ t: "voice-settings", settings })), { t: "voice-settings", settings });
  }
  for (const maxTurnMs of [0, -1000, 4999, 5500, 30001, NaN, Infinity, null, "15000"]) {
    const settings: Omit<VoiceSettings, "maxTurnMs"> & { maxTurnMs: number | string | null } = { ...migrated, maxTurnMs };
    assert.equal(voiceSettingsSchema.safeParse(settings).success, false);
    assert.equal(parseVoiceEvent(JSON.stringify({ t: "voice-settings", settings })), null);
  }
  assert.deepEqual(parseServerMessage('{"t":"app-settings-changed"}'), { t: "app-settings-changed" });
});

test("automatic-language silence is independent and both parsers validate new settings", () => {
  const settings = { ...DEFAULT_VOICE_SETTINGS, automaticLanguage: { mode: "manual" as const, silenceMs: 800 },
    noiseGateLevel: 25, languages: { ko: { mode: "manual" as const, silenceMs: 500 }, th: { mode: "manual" as const, silenceMs: 2400 } } };
  assert.equal(silenceMsFor(settings, ["ko", "th"], true), 800);
  assert.equal(silenceMsFor(settings, ["ko"], true), 800, "automatic detection still applies with one candidate");
  assert.equal(silenceMsFor(settings, ["ko"]), 500, "fixed language stays independent");
  assert.equal(silenceMsFor(settings, ["th"]), 2400);
  assert.equal(silenceMsFor({ ...settings, automaticLanguage: DEFAULT_VOICE_SETTINGS.automaticLanguage }, ["ko", "th"], true), 2400);
  assert.deepEqual(parseVoiceEvent(JSON.stringify({ t: "voice-settings", settings })), { t: "voice-settings", settings });
  for (const noiseGateLevel of [0, 1, 25, 100]) {
    const value = { ...settings, noiseGateLevel };
    assert.deepEqual(voiceSettingsSchema.parse(value), value);
    assert.deepEqual(parseVoiceEvent(JSON.stringify({ t: "voice-settings", settings: value })), { t: "voice-settings", settings: value });
  }
  for (const patch of [
    ...[-1, 101, 1.5, null, "25", NaN, Infinity].map((noiseGateLevel) => ({ noiseGateLevel })),
    ...[null, [], { mode: "auto", silenceMs: 301 }, { mode: "manual", silenceMs: 5001 }, { mode: "invalid", silenceMs: 1100 }].map((automaticLanguage) => ({ automaticLanguage })),
  ]) {
    const value = { ...settings, ...patch };
    assert.equal(voiceSettingsSchema.safeParse(value).success, false);
    assert.equal(parseVoiceEvent(JSON.stringify({ t: "voice-settings", settings: value })), null);
  }
});

test("desktop writes reject unsafe transport, arbitrary commands and unconfirmed tunnel shutdown", () => {
  assert.equal(desktopTransportAllowed("http://127.0.0.1:3000", new Headers({ "x-lct-ip": "192.168.1.2" })), false);
  assert.equal(desktopTransportAllowed("http://192.168.1.1:3000", new Headers({ "x-lct-ip": "127.0.0.1" })), false);
  assert.equal(desktopTransportAllowed("http://127.0.0.1:3000", new Headers({ "x-lct-ip": "127.0.0.1" })), true);
  assert.equal(desktopTransportAllowed("http://public.example", new Headers({ "x-forwarded-proto": "https" })), true);
  for (const action of [{ action: "shell", command: "ignored" }, { action: "stop" }, { action: "start", command: "ignored" }, { action: "verify", token: "short" }]) assert.equal(desktopActionSchema.safeParse(action).success, false);
  assert.equal(desktopActionSchema.safeParse({ action: "stop", confirmed: true }).success, true);
});

test("Electron loopback Host remains writable when Next rewrites request.url to its bind address", () => {
  const internalUrl = "http://0.0.0.0:3000/api/admin/desktop";
  for (const host of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000"]) {
    for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) {
      assert.equal(desktopTransportAllowed(internalUrl, new Headers({ host, "x-lct-ip": ip, "x-forwarded-proto": "http" })), true);
    }
    assert.equal(desktopTransportAllowed(internalUrl, new Headers({ host, "x-lct-ip": "192.168.1.2" })), false);
    assert.equal(desktopTransportAllowed(internalUrl, new Headers({ host })), false);
  }
  assert.equal(desktopTransportAllowed("http://localhost:3000", new Headers({ host: "192.168.1.2:3000", "x-lct-ip": "127.0.0.1" })), false);
  assert.equal(desktopTransportAllowed(internalUrl, new Headers({ host: "public.example", "x-lct-ip": "8.8.8.8", "x-forwarded-proto": "https" })), true);
  assert.equal(desktopTransportAllowed(internalUrl, new Headers({ host: "[invalid", "x-lct-ip": "127.0.0.1" })), false);
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
    repo.setVoiceSettings({ ...DEFAULT_VOICE_SETTINGS, mode: "manual", silenceMs: 2300 });
    getDb().close(); globalThis.__meetingDb = undefined;
    assert.deepEqual(repo.getVoiceSettings(), { ...DEFAULT_VOICE_SETTINGS, mode: "manual", silenceMs: 2300 });
    const settings = { ...DEFAULT_VOICE_SETTINGS, maxTurnMs: 30000, noiseGateLevel: 25, automaticLanguage: { mode: "manual" as const, silenceMs: 800 }, languages: { ko: { mode: "manual" as const, silenceMs: 500 }, th: { mode: "manual" as const, silenceMs: 2400 } } };
    repo.setVoiceSettings(settings);
    getDb().close(); globalThis.__meetingDb = undefined;
    assert.deepEqual(repo.getVoiceSettings(), settings);
    assert.equal(repo.listMeetings().length, 0);
    notifyAppSettings(); assert.equal(notifications, 1);
    unsubscribe(); notifyAppSettings(); assert.equal(notifications, 1);
    for (const lang of ["ko", "vi", "th", "si"]) assert.ok(i18n.getAdminStrings(lang).appSettings.paidWarning);
    assert.ok(i18n.sourceEntries().some((row) => row.key === "admin.appSettings.delay"));
    assert.ok(i18n.sourceEntries().some((row) => row.key === "admin.appSettings.perLanguage"));
    for (const key of ["maxTurn", "maxTurnNote", "resetMaxTurn", "automaticLanguage", "noiseGate", "noiseGateNote", "resetNoiseGate", "noiseGateMeter"] as const) {
      assert.ok(i18n.sourceEntries().some((row) => row.key === `admin.appSettings.${key}`));
      for (const lang of ["ko", "vi", "th", "si", "en", "zh-CN", "fil"]) assert.ok(i18n.getAdminStrings(lang).appSettings[key]);
    }
    repo.upsertUiStrings("vi", [{ key: "admin.appSettings.noiseGate", text: "Manual noise label", origin: "manual" }]);
    assert.equal(i18n.getAdminStrings("vi").appSettings.noiseGate, "Manual noise label");
    repo.upsertUiStrings("vi", [{ key: "admin.appSettings.maxTurn", text: "Manual duration label", origin: "manual" }]);
    assert.equal(i18n.getAdminStrings("vi").appSettings.maxTurn, "Manual duration label");
    assert.ok(i18n.sourceEntries().some((row) => row.key === "ui.status.scrollToLatest"));
    assert.ok(i18n.sourceEntries().some((row) => row.key === "ui.capture.stopping"));
    for (const lang of ["ko", "vi", "th", "si"]) assert.ok(i18n.getStrings(lang).capture.stopping);
    assert.ok(i18n.sourceEntries().some((row) => row.key === "admin.tunnel.retry"));
    for (const lang of ["ko", "vi", "th", "si"]) assert.ok(i18n.getStrings(lang).status.scrollToLatest);
    repo.upsertUiStrings("vi", [{ key: "admin.appSettings.title", text: "Manual settings", origin: "manual" }]);
    assert.equal(i18n.getAdminStrings("vi").appSettings.title, "Manual settings");
  } finally {
    unsubscribe(); getDb().close(); globalThis.__meetingDb = undefined;
    if (previous === undefined) delete process.env.DATABASE_PATH; else process.env.DATABASE_PATH = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
