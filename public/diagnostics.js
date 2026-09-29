/* Lightweight, best-effort error telemetry: no text, stack, audio, cookies or query strings. */
(() => {
  if (window.__lctDiagnostics || !window.fetch) return;
  window.__lctDiagnostics = true;
  const original = window.fetch;
  const page = /^\/(?:in(?:\/all)?|out|all|capture|join(?:\/input)?)\/([^/]+)\/?$/.exec(location.pathname);
  const pageId = window.crypto?.randomUUID?.();
  let allowance = 120, refreshed = Date.now(), sequence = 0;
  function tag(element) {
    return !element ? "NONE" : ["BUTTON", "SELECT", "INPUT", "TEXTAREA", "DIALOG", "BODY"].includes(element.tagName) ? element.tagName : "OTHER";
  }
  function snapshot(target) {
    const active = document.activeElement;
    return { focused: document.hasFocus(), visible: document.visibilityState === "visible",
      activeTag: tag(active), activeDisabled: !!active?.matches(":disabled"),
      targetTag: tag(target), disabled: !!target?.matches(":disabled"),
      controlIndex: target ? Array.from(document.querySelectorAll("select")).indexOf(target) : -1,
      dialogCount: document.querySelectorAll("dialog[open]").length };
  }
  function report(event, detail = {}) {
    if (Date.now() - refreshed > 60000) { allowance = 120; refreshed = Date.now(); }
    if (allowance-- <= 0) return;
    const payload = { event, route: location.pathname, pageId, sequence: ++sequence, ...detail };
    if (page) payload.token = page[2];
    // Token is only for endpoint authorization and is never logged by the receiver.
    void original.call(window, "/api/diagnostics/client", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify(payload), credentials: "same-origin", keepalive: true }).catch(() => {});
  }
  window.addEventListener("error", (event) => {
    if (event.target !== window) report("resource-error");
    else report("error", { line: event.lineno || 0, column: event.colno || 0 });
  }, true);
  window.addEventListener("unhandledrejection", () => report("rejection"));
  window.addEventListener("offline", () => report("offline"));
  window.addEventListener("online", () => report("online"));
  // No polling, keypresses or field contents: only transitions needed to diagnose native select/focus failures.
  window.addEventListener("lct-voice-diagnostic", (event) => report("voice", { ...event.detail, ...snapshot() }));
  const settingsOpen = () => !!document.querySelector(".app-settings-panel[open]");
  window.addEventListener("focus", () => { if (settingsOpen()) report("window-focus", snapshot()); });
  window.addEventListener("blur", () => { if (settingsOpen()) report("window-blur", snapshot()); });
  document.addEventListener("visibilitychange", () => { if (settingsOpen()) report("visibility", snapshot()); });
  for (const [domEvent, event] of [["pointerdown", "select-pointer"], ["change", "select-change"], ["focusin", "control-focus"]]) {
    document.addEventListener(domEvent, (e) => {
      if (settingsOpen() && e.target instanceof Element && (e.target.tagName === "SELECT" || (domEvent === "focusin" && e.target.tagName === "BUTTON"))) {
        report(event, snapshot(e.target));
      }
    }, true);
  }
  document.addEventListener("close", (event) => {
    if (event.target instanceof HTMLDialogElement) report("dialog-close", snapshot(event.target));
  }, true);
  window.fetch = function (...args) {
    return original.apply(this, args).then((response) => {
      if (!response.ok) {
        const detail = { status: response.status };
        const id = response.headers.get("x-lct-request-id");
        const build = response.headers.get("x-lct-build-id");
        if (id) detail.requestId = id;
        if (build) detail.buildId = build;
        report("fetch-failed", detail);
      }
      return response;
    }, (error) => { if (error?.name !== "AbortError") report("fetch-failed", { status: 0 }); throw error; });
  };
})();
