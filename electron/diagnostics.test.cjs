/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const test = require("node:test");
const { mkdtemp, writeFile, readFile, readdir, rm, mkdir, symlink } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const { spawnSync } = require("node:child_process");
const { createLogger, safeRoute, safeFields, errorFields } = require("./diagnostics.cjs");

test("diagnostics mask tokens, free text, identities and unsafe paths", () => {
  for (const url of ["/in/secret-token", "/in/all/secret-token", "/out/secret-token?key=FAKE_SECRET", "/join/input/secret-token"]) {
    assert.equal(safeRoute(url).includes("secret"), false);
  }
  assert.equal(safeRoute("/api/pages/secret/messages/123?password=FAKE_SECRET"), "/api/pages/:token/messages/:id");
  assert.equal(safeRoute("/api/pages/secret/secret/secret"), "/:other");
  assert.equal(safeRoute("/api/admin/FAKE_SECRET"), "/:other");
  assert.equal(safeRoute("/admin/meetings/secret/log"), "/admin/meetings/:id/log");
  const fields = safeFields({ token: "FAKE_SECRET", body: "private speech", stack: "private stack", ip: "192.0.2.3", title: "private title", action: "share", status: 200, code: "sk-FAKE_SECRET" });
  assert.deepEqual(fields, { action: "share", status: 200 });
  assert.deepEqual(errorFields(Object.assign(new Error("private speech"), { code: "ENOENT" })), { errorType: "Error", code: "ENOENT" });
});

test("diagnostics preserve crash metadata and buffered events without changing exit behavior", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lct-diagnostics-crash-"));
  try {
    const result = spawnSync(process.execPath, ["-e", `const d=require(${JSON.stringify(require.resolve("./diagnostics.cjs"))});d.initializeDiagnostics(process.argv[1]);d.withContext({requestId:'12345678-1234-1234-1234-123456789abc'},()=>d.log('info','test.before-crash'));throw new Error('PRIVATE_CRASH_MESSAGE');`, directory]);
    assert.equal(result.status, 1);
    const contents = (await Promise.all((await readdir(directory)).map(file => readFile(join(directory, file), "utf8")))).join("");
    for (const expected of ["test.before-crash", "process.uncaught", "process.exit", "12345678-1234-1234-1234-123456789abc"]) assert.ok(contents.includes(expected));
    assert.equal(contents.includes("PRIVATE_CRASH_MESSAGE"), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test("diagnostics retain at most 48 hours, enforce disk cap, preserve unrelated files and bound floods", async () => {
  const directory = await mkdtemp(join(tmpdir(), "lct-diagnostics-test-"));
  let now = 1800000000000;
  let logger;
  try {
    const expired = `lct-${now - 49 * 3600000}-1-12345678-0.jsonl`;
    const recent = `lct-${now - 3600000}-1-12345678-0.jsonl`;
    await writeFile(join(directory, expired), "old");
    await writeFile(join(directory, recent), "recent");
    await writeFile(join(directory, "unrelated.txt"), "keep");
    await mkdir(join(directory, `lct-${now}-1-12345678-9.jsonl`));
    logger = createLogger(directory, { now: () => now, maxBytes: 2000 });
    await logger.flush();
    logger.log("info", "test.event", { body: "FAKE_SECRET", count: 1 });
    await logger.flush();
    let files = await readdir(directory);
    assert.equal(files.includes(expired), false);
    assert.equal(files.includes(recent), true);
    const output = await Promise.all(files.filter(file => file.endsWith(".jsonl") && !file.endsWith("-9.jsonl")).map(file => readFile(join(directory, file), "utf8")));
    assert.equal(output.join("").includes("FAKE_SECRET"), false);
    for (let i = 0; i < 20000; i++) logger.log("info", "test.flood", { count: i });
    await logger.flush();
    files = await readdir(directory);
    let total = 0;
    for (const file of files.filter(file => file.endsWith(".jsonl") && !file.endsWith("-9.jsonl"))) total += (await readFile(join(directory, file))).length;
    assert.ok(total <= 2000);
    assert.equal(await readFile(join(directory, "unrelated.txt"), "utf8"), "keep");
    now += 49 * 3600000;
    await logger.flush();
    assert.equal((await readdir(directory)).includes(recent), false);
    await logger.close(); logger = null;
    // A regular file instead of a directory is an I/O failure, not an application failure.
    logger = createLogger(join(directory, "unrelated.txt"));
    logger.log("error", "test.disk-failure");
    await logger.close(); logger = null;
    if (process.platform !== "win32") {
      const link = join(directory, `lct-${now - 49 * 3600000}-1-12345678-0.jsonl`);
      await symlink(join(directory, "unrelated.txt"), link);
      logger = createLogger(directory, { now: () => now });
      await logger.flush();
      assert.equal(await readFile(link, "utf8"), "keep");
    }
  } finally { await logger?.close(); await rm(directory, { recursive: true, force: true }); }
});
