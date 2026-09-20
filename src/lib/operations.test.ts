import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as pathJoin } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { parseServerMessage } from "./client-json";
import { connectionCounts, disconnectAdminConnections, join, leave, notifyConnectionsChanged, publish, subscribeConnections, type Connection } from "./realtime/hub";

test("shared connection snapshots, batched admin updates, desktop links and editable operations phrases", async () => {
  const directory = mkdtempSync(pathJoin(tmpdir(), "lct-operations-"));
  const previous = process.env.DATABASE_PATH;
  process.env.DATABASE_PATH = pathJoin(directory, "test.db");
  const repo = await import("./repo");
  const { getDb } = await import("./db");
  const { desktopOperations, sessionConnections } = await import("./desktop-operations");
  const i18n = await import("./i18n");
  const connections: Connection[] = [];
  let unsubscribe = () => {};
  try {
    const meeting = repo.createMeeting({ title: "counts", engine: "google", config: {
      languages: ["ko", "vi", "th", "si"].map((lang) => ({ lang, inputEnabled: true, outputEnabled: lang !== "si" })),
      speakerLabels: false, combinedInputFallbackLang: "ko",
    } });
    const changed: string[][] = [];
    let closed = false;
    unsubscribe = subscribeConnections({ changed: (ids) => changed.push(ids), close: () => { closed = true; } });
    const frames: unknown[] = [];
    for (const [index, kind] of (["input", "output", "output", "combined-input", "combined", "capture", "dashboard"] as const).entries()) {
      const connection: Connection = { clientId: "same-tab-id", meetingId: meeting.id, kind,
        lang: kind === "input" ? "ko" : kind === "output" ? "vi" : null, name: "", nameClaimed: false, draft: "",
        send: (frame) => frames.push(frame), close: () => {},
      };
      connections.push(connection);
      join(connection);
      if (index === 0) join(connection); // the same object cannot inflate the count
    }
    const counts = connectionCounts(meeting.id, ["ko", "vi", "th", "si"]);
    assert.equal(counts.total, 6);
    assert.deepEqual(counts.languages, [
      { lang: "ko", input: 1, output: 0 }, { lang: "vi", input: 0, output: 2 },
      { lang: "th", input: 0, output: 0 }, { lang: "si", input: 0, output: 0 },
    ]);
    assert.deepEqual([counts.combinedInput, counts.combined, counts.capture], [1, 1, 1]);
    await delay(550);
    assert.deepEqual(changed, [[meeting.id]]);
    const snapshot = sessionConnections();
    assert.equal(snapshot.sessions[0].total, 6);
    const frame = { t: "connection-stats", snapshot: true, at: Date.now(), ...snapshot } satisfies Parameters<typeof publish>[1];
    assert.deepEqual(parseServerMessage(JSON.stringify(frame)), frame);
    assert.equal(parseServerMessage(JSON.stringify({ ...frame, sessions: [{ ...snapshot.sessions[0], total: -1 }] })), null);
    publish(meeting.id, frame);
    assert.equal(frames.length, 0, "stats never leak through participant broadcasts");
    const desktop = desktopOperations("ko");
    assert.equal(desktop.sessions[0].counts.total, snapshot.sessions[0].total);
    assert.equal(desktop.sessions[0].pages.some((page) => page.kind === "output" && page.lang === "si"), false);
    assert.ok(desktop.sessions[0].pages.find((page) => page.kind === "combined-input")?.path.startsWith("/in/all/"));
    assert.equal(desktop.siteManagement, "앱 관리");
    for (const lang of ["ko", "vi", "th", "si"]) {
      const strings = i18n.getAdminStrings(lang).operations;
      assert.ok(strings.helpText.includes("/help"));
      assert.ok(strings.managePermission);
      assert.ok(i18n.sourceEntries().some((entry) => entry.key === "admin.operations.helpText"));
    }
    for (const lang of ["ko", "vi", "th", "si", "en", "zh-CN", "fil"]) {
      const resolved = i18n.resolveEntries(lang);
      for (const prefix of ["admin.appSettings.", "admin.connectionSummary."]) {
        const entries = resolved.filter((entry) => entry.key.startsWith(prefix));
        assert.ok(entries.length > 0);
        assert.ok(entries.every((entry) => entry.origin === "builtin" && entry.text.trim()), `${lang} ${prefix}`);
        if (lang !== "ko") assert.ok(entries.every((entry) => !/[가-힣]/.test(entry.text)), `${lang} must not fall back to Korean`);
      }
      assert.ok(i18n.getAdminStrings(lang).connectionSummary.title);
    }
    assert.ok(i18n.sourceEntries().some((entry) => entry.key === "admin.connectionSummary.title"));
    repo.upsertUiStrings("vi", [{ key: "admin.operations.menu", text: "Manual menu", origin: "manual" }, { key: "admin.security.siteManagement", text: "Manual app title", origin: "manual" }]);
    assert.equal(desktopOperations("vi").strings.menu, "Manual menu");
    assert.equal(desktopOperations("vi").siteManagement, "Manual app title");
    repo.upsertUiStrings("ko", [{ key: "admin.security.siteManagement", text: "사이트 관리", origin: "machine" }]);
    repo.migrateAppManagementTitle(getDb());
    assert.equal(desktopOperations("ko").siteManagement, "앱 관리");
    assert.equal(desktopOperations("vi").siteManagement, "Manual app title");
    repo.addLanguage("en");
    repo.upsertUiStrings("en", [{ key: "admin.appSettings.title", text: "My settings", origin: "manual" }]);
    assert.equal(i18n.getAdminStrings("en").appSettings.title, "My settings");
    assert.equal(i18n.resolveEntries("en").find((entry) => entry.key === "admin.appSettings.title")?.origin, "manual");
    repo.deleteUiString("en", "admin.appSettings.title");
    assert.equal(i18n.getAdminStrings("en").appSettings.title, "App settings");
    assert.equal(i18n.resolveEntries("en").find((entry) => entry.key === "admin.list.heading")?.origin, "fallback", "partial built-ins must not mislabel unrelated Korean fallback phrases");
    repo.upsertUiStrings("en", [{ key: "admin.operations.helpText", text: "Custom help", origin: "machine" }]);
    assert.equal(desktopOperations("en").strings.helpText, "Custom help");
    repo.deleteUiString("en", "admin.operations.helpText");
    assert.ok(desktopOperations("en").strings.helpText.includes("/help"));
    leave(connections[1]); leave(connections[1]);
    assert.equal(connectionCounts(meeting.id).total, 5);
    disconnectAdminConnections();
    assert.equal(closed, true);
    repo.closeMeeting(meeting.id);
    notifyConnectionsChanged(meeting.id);
    assert.equal(sessionConnections().sessions[0].status, "closed");
    assert.equal(desktopOperations("ko").sessions.length, 0);
    repo.deleteClosedMeeting(meeting.id);
    assert.deepEqual(sessionConnections([meeting.id]), { sessions: [], removed: [meeting.id] });
  } finally {
    unsubscribe();
    for (const connection of connections) leave(connection);
    getDb().close();
    globalThis.__meetingDb = undefined;
    if (previous === undefined) delete process.env.DATABASE_PATH;
    else process.env.DATABASE_PATH = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});
