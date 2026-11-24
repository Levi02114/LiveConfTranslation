"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { newBrowserId } from "@/lib/browser-id";
import { readZoomMeeting, startZoomCapture, stopZoomCapture, ZoomChatDelivery, type ZoomStopReport } from "@/lib/zoom-chat";
import { engineIdSchema, type EngineId } from "@/lib/translate/types";
import { AppearanceControls } from "@/components/appearance-controls";
import { useSetAdminLang } from "@/hooks/use-admin-lang";
import { usePublicOrigin } from "@/hooks/use-public-origin";
import type { AdminStrings, UiStrings } from "@/lib/i18n-builtin";
import type { Language } from "@/lib/languages";
import { zoomActionSchema, zoomCredentialsSchema, zoomLanguageId, zoomSettingsSchema, zoomStatusSchema, type ZoomStatus } from "@/lib/zoom-contract";

type Sdk = typeof import("@zoom/appssdk").default;
const field = "w-full min-w-0 border border-line bg-bg px-3 py-2";
const button = "cursor-pointer border border-line px-3 py-2 disabled:cursor-default disabled:opacity-40";
const errorSchema = z.object({ error: z.string() });

async function zoomRequest(method: string, body?: z.infer<typeof zoomActionSchema> | z.infer<typeof zoomCredentialsSchema>, meeting?: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(`/api/admin/zoom${meeting ? `?meeting=${encodeURIComponent(meeting)}` : ""}`, { method, cache: "no-store", signal: controller.signal,
      headers: body ? { "content-type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    const data: unknown = await response.json();
    if (!response.ok) throw new Error(errorSchema.safeParse(data).data?.error ?? "requestFailed");
    return data;
  } finally { clearTimeout(timer); }
}

function errorText(strings: AdminStrings["zoom"], code: string) {
  return Object.entries(strings).find(([key]) => key === code)?.[1] ?? strings.requestFailed;
}

export function ZoomSettings({ strings }: { strings: AdminStrings }) {
  const s = strings.zoom;
  const [status, setStatus] = useState<z.infer<typeof zoomSettingsSchema> | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [webhookSecret, setWebhookSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    let disposed = false;
    void zoomRequest("GET").then((data) => {
      const value = zoomSettingsSchema.parse(data);
      if (!disposed) { setStatus(value); setClientId(value.clientId); }
    }).catch(() => { if (!disposed) setNotice(s.requestFailed); });
    return () => { disposed = true; };
  }, [s.requestFailed]);
  async function save() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setNotice("");
    try {
      const value = zoomSettingsSchema.parse(await zoomRequest("PUT", { clientId, clientSecret, webhookSecret }));
      setStatus(value); setClientSecret(""); setWebhookSecret(""); setNotice(strings.security.saved);
    } catch (error) { setNotice(errorText(s, error instanceof Error ? error.message : "requestFailed")); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="grid min-w-0 gap-4">
    <h2>{s.title}</h2><p>{s.credentialsHelp}</p>
    <fieldset disabled={!status?.writable || status.active || busy} className="grid min-w-0 gap-3">
      <label>{s.clientId}<input className={field} autoComplete="off" value={clientId} onChange={(event) => setClientId(event.target.value)} maxLength={256} /></label>
      <label>{s.clientSecret}<input className={field} type="password" autoComplete="new-password" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} maxLength={2048} /></label>
      <label>{s.webhookSecret}<input className={field} type="password" autoComplete="new-password" value={webhookSecret} onChange={(event) => setWebhookSecret(event.target.value)} maxLength={2048} /></label>
      <button className={button} disabled={!clientId.trim()} onClick={() => void save()}>{busy ? strings.security.saving : strings.security.save}</button>
    </fieldset>
    <p>{status?.configured ? s.ready : s.missing}</p>
    {status && !status.writable ? <p>{s.insecure}</p> : null}
    {status?.active ? <p>{s.busy}</p> : null}
    <p role="status">{notice}</p><p>{s.setupHelp}</p>
    {status ? <><label>{s.homeUrl}<input className={field} readOnly value={status.homeUrl} /></label>
      <label>{s.webhookUrl}<input className={field} readOnly value={status.webhookUrl} /></label></> : null}
    <a className="underline" href="https://developers.zoom.us/docs/rtms/meetings/quickstart-websockets/" target="_blank" rel="noreferrer">{s.setup}</a>
    <a className="underline" href="/admin/zoom">{s.open}</a>
  </section>;
}

export function ZoomPanel({ strings, ui, lang, languages, engines, defaultEngine, openaiModel }: {
  strings: AdminStrings; ui: UiStrings; lang: string; languages: Language[];
  engines: { id: EngineId; label: string; configured: boolean }[]; defaultEngine: EngineId; openaiModel: string;
}) {
  const s = strings.zoom;
  const origin = usePublicOrigin();
  const setLang = useSetAdminLang();
  const [meeting, setMeeting] = useState<{ uuid: string; title: string } | null>(null);
  const [existing, setExisting] = useState<z.infer<typeof zoomSettingsSchema>["existingSession"]>(null);
  const [engine, setEngine] = useState(defaultEngine);
  const [fallbackEngine, setFallbackEngine] = useState<EngineId | null>(null);
  const [sourceLang, setSourceLang] = useState(languages.find((lang) => zoomLanguageId(lang.code) >= 0)?.code ?? "");
  const [targets, setTargets] = useState<string[]>([]);
  const [audioMode, setAudioMode] = useState<"speakers" | "mixed" | "transcript" | "chat">("speakers");
  const [chat, setChat] = useState(false);
  const [consent, setConsent] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [owner, setOwner] = useState<string | null>(null);
  const [status, setStatus] = useState<ZoomStatus | null>(null);
  const [error, setError] = useState("");
  const sdk = useRef<Sdk | null>(null);
  const lock = useRef(false);
  const currentOwner = useRef<string | null>(null);
  const boundMeeting = useRef("");
  // 채팅 전송만 하는 실행은 Zoom RTMS를 시작하지 않았으므로 멈출 것도 없다.
  const boundChatOnly = useRef(false);
  const stopping = useRef<Promise<unknown> | null>(null);
  const pendingStart = useRef<AbortController | null>(null);
  const recorded = status?.session ?? existing;
  // Zoom 자체 전사만 첫 발언 언어가 필요하다. 음성 모드는 세션 언어 중 첫 언어를 기준으로 보낸다.
  const startLang = audioMode === "transcript" ? (targets.includes(sourceLang) ? sourceLang : "") : targets[0] ?? "";

  useEffect(() => () => { pendingStart.current?.abort(); }, []);

  async function connect() {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setReady(false);
    try {
      const zoom = (await import("@zoom/appssdk")).default;
      const capabilities = ["getRunningContext", "getMeetingUUID", "sendMessageToChat", "startRTMS", "stopRTMS"] as const;
      // 선택 기능: getMeetingContext(회의 제목, 호스트·공동 호스트 전용)와 getRTMSStatus(중지 결과 확인).
      // 일반 참가자에게는 제목 API가 지원되지 않으므로 필수로 요구하지 않는다.
      const config = await zoom.config({ version: "0.16", capabilities: [...capabilities, "getMeetingContext", "getRTMSStatus"], timeout: 10000 });
      if (config.runningContext !== "inMeeting" || config.auth.status !== "authorized" || capabilities.some((api) => config.unsupportedApis.includes(api))) throw new Error();
      const current = await readZoomMeeting(zoom, s.untitled);
      const saved = zoomSettingsSchema.parse(await zoomRequest("GET", undefined, current.uuid)).existingSession;
      setMeeting(current); setExisting(saved); setStatus(null);
      if (saved) { setEngine(saved.engine); setFallbackEngine(saved.fallbackEngine); setTargets(saved.targets); }
      if (saved?.closed) { setError("invalidSession"); return; }
      sdk.current = zoom; setReady(true);
    } catch { setError("zoomRequired"); }
    finally { lock.current = false; setBusy(false); }
  }

  function stop() {
    currentOwner.current = null; setOwner(null);
    setStatus((value) => value ? { ...value, state: "stopped", next: null, pending: 0 } : null);
  }

  async function start() {
    if (lock.current || currentOwner.current || !sdk.current || !meeting || !consent || !targets.length || !startLang) return;
    lock.current = true; setBusy(true); setError("");
    const next = newBrowserId();
    const controller = new AbortController();
    pendingStart.current = controller;
    const zoom = sdk.current;
    try {
      await stopping.current;
      if (controller.signal.aborted) return;
      const current = await readZoomMeeting(zoom, s.untitled);
      if (current.uuid !== meeting.uuid) { setReady(false); throw new Error("zoomRequired"); }
      if (controller.signal.aborted) return;
      boundMeeting.current = current.uuid;
      const chatOnly = audioMode === "chat";
      boundChatOnly.current = chatOnly;
      const result = zoomStatusSchema.parse(await zoomRequest("POST", { action: "start", owner: next,
        zoomMeeting: current.uuid, zoomTitle: current.title, engine, fallbackEngine, sourceLang: startLang, targets, audioMode, chat, consent: true }));
      if (result.state !== (chatOnly ? "live" : "waiting")) throw new Error("requestFailed");
      currentOwner.current = next;
      setStatus(result);
      setExisting({ ...result.session, closed: false, engine, fallbackEngine, model: existing?.model ?? openaiModel, targets });
      // 서버 트리를 다시 받지 않는다. 이 화면은 응답으로 상태를 갖고, 관리자 목록은 POST의 revalidatePath가 맡는다.
      if (!chatOnly) await startZoomCapture(zoom, current.uuid, controller.signal);
      else if (controller.signal.aborted) throw new DOMException("", "AbortError");
      setOwner(next);
    } catch (error) {
      // A lost start response may still have armed the backend; always cancel our ID.
      await zoomRequest("POST", { action: "stop", owner: next }).catch(() => {});
      currentOwner.current = null;
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "requestFailed");
    } finally {
      pendingStart.current = null;
      lock.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }

  useEffect(() => {
    if (!owner || !sdk.current) return;
    const zoom = sdk.current;
    const runOwner = owner;
    const runMeeting = boundMeeting.current;
    const chatOnly = boundChatOnly.current;
    let disposed = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const delivery = new ZoomChatDelivery(runMeeting, zoom);
    async function tick() {
      if (disposed || currentOwner.current !== owner) return;
      let value: ZoomStatus;
      try {
        value = zoomStatusSchema.parse(await zoomRequest("POST", { action: "poll", owner: runOwner, ack: delivery.ack }));
        failures = 0;
      } catch {
        if (++failures < 3 && !disposed) { timer = setTimeout(() => void tick(), 1000); return; }
        if (!disposed) { setError("requestFailed"); currentOwner.current = null; setOwner(null); }
        return;
      }
      if (disposed || currentOwner.current !== owner) return;
      setStatus(value);
      if (value.state === "error" || value.state === "stopped") {
        if (value.error) setError(value.error);
        currentOwner.current = null; setOwner(null); return;
      }
      if (value.next) {
        try {
          await delivery.deliver(value.next, () => !disposed && currentOwner.current === owner);
        } catch {
          if (!disposed) { setError("sendUncertain"); currentOwner.current = null; setOwner(null); }
          return;
        }
      }
      if (!disposed) timer = setTimeout(() => void tick(), 1000);
    }
    void tick();
    return () => {
      disposed = true; clearTimeout(timer);
      setBusy(true);
      // The next start waits for this stop to finish, including a delayed SDK reply.
      // Zoom 쪽을 먼저 멈춘다. 서버가 먼저 스트림을 닫으면 stopRTMS가 이미 끝난 스트림에 실패를 돌려준다.
      stopping.current = (async () => {
        if (chatOnly) { await zoomRequest("POST", { action: "stop", owner }).catch(() => {}); return; }
        const report: ZoomStopReport = await stopZoomCapture(zoom, runMeeting).catch(() => ({ ok: false, response: "rejected", status: "unknown" }));
        if (!report.ok) { setReady(false); setError("stopFailed"); }
        await zoomRequest("POST", { action: "stop", owner, sdk: { response: report.response, code: report.code, status: report.status } }).catch(() => {});
      })().finally(() => setBusy(false));
    };
  }, [owner]);

  return <section className="grid min-w-0 gap-5">
    <AppearanceControls strings={ui.appearance} leading={<span>{s.title}</span>}
      language={{ value: lang, label: strings.language.label, options: languages, onChange: setLang }} />
    <h1>{s.title}</h1><p>{s.archivePrivacy}</p>
    <button className={button} disabled={busy || Boolean(owner)} onClick={() => void connect()}>{busy ? s.working : ready ? s.meetingReady : s.connect}</button>
    <fieldset disabled={busy || Boolean(owner)} className="grid min-w-0 gap-4">
      <div><p>{s.sessionTitle}</p><output className={`${field} block break-words`} aria-label={s.sessionTitle}>{meeting?.title ?? s.untitled}</output></div>
      <p className="text-muted">{s.autoSession}</p>
      <label>{strings.list.engine}<select className={field} value={engine} disabled={Boolean(existing)} onChange={(event) => {
        const next = engineIdSchema.parse(event.target.value); setEngine(next); if (fallbackEngine === next) setFallbackEngine(null);
      }}>{engines.map((item) => <option key={item.id} value={item.id}>{item.label}{item.configured ? "" : ` (${item.id === "local" ? strings.list.notInstalled : strings.list.engineNoKey})`}</option>)}</select></label>
      <label>{strings.list.fallbackEngine}<select className={field} value={fallbackEngine ?? ""} disabled={Boolean(existing)} onChange={(event) => setFallbackEngine(engineIdSchema.safeParse(event.target.value).data ?? null)}>
        <option value="">{strings.list.noFallback}</option>{engines.filter((item) => item.id !== engine).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
      </select></label>
      {engine === "openai" || fallbackEngine === "openai" ? <p>{strings.list.model}: {existing?.model ?? openaiModel}</p> : null}
      <label>{s.mode}<select className={field} value={audioMode} onChange={(event) => {
        const next = event.target.value; if (next === "speakers" || next === "mixed" || next === "transcript" || next === "chat") setAudioMode(next);
      }}>
        <option value="speakers">{s.modeSpeakers}</option><option value="mixed">{s.modeMixed}</option><option value="transcript">{s.modeTranscript}</option>
        <option value="chat">{s.modeChat}</option>
      </select></label><p className="text-muted">{audioMode === "chat" ? s.chatOnlyHelp : s.modeHelp}</p>
      {audioMode === "transcript" ? <><label>{s.source}<select className={field} value={sourceLang} onChange={(event) => setSourceLang(event.target.value)}>
        {languages.filter((lang) => zoomLanguageId(lang.code) >= 0 && targets.includes(lang.code)).map((lang) => <option key={lang.code} value={lang.code}>{lang.nativeName}</option>)}
      </select></label><p className="text-muted">{s.sourceHelp}</p></> : null}
      <fieldset className="grid gap-2 border border-line p-3"><legend>{s.targets}</legend>
        {languages.map((lang) => <label key={lang.code} className="flex items-start gap-2">
          <input type="checkbox" disabled={Boolean(existing)} checked={targets.includes(lang.code)} onChange={(event) => setTargets((old) => event.target.checked ? [...old, lang.code] : old.filter((code) => code !== lang.code))} />{lang.nativeName}
        </label>)}
      </fieldset><p className="text-muted">{s.targetsHelp}</p>
      {audioMode !== "chat" ? <><label className="flex items-start gap-2"><input type="checkbox" checked={chat} onChange={(event) => setChat(event.target.checked)} />{s.chat}</label>
        <p className="text-muted">{s.chatHelp}</p></> : null}
      <label className="flex items-start gap-2"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />{s.archiveConsent}</label>
    </fieldset>
    <div className="flex flex-wrap gap-2"><button className={button} disabled={!ready || busy || Boolean(owner) || !meeting || !startLang || !targets.length || !consent} onClick={() => void start()}>{busy ? s.working : s.archiveStart}</button>
      <button className={button} disabled={!owner || busy} onClick={() => void stop()}>{s.stop}</button></div>
    {recorded ? <nav className="grid min-w-0 gap-2 border border-line p-3" aria-label={s.savedSession}>
      <p className="break-words">{s.savedSession}: {recorded.title}</p>
      <a className="underline" href={`/admin/meetings/${recorded.id}`} target="_blank" rel="noreferrer">{s.manageSession}</a>
      {recorded.viewerPath ? <a className="underline" href={`${origin}${recorded.viewerPath}`} target="_blank" rel="noreferrer">{s.viewSession}</a> : null}
    </nav> : null}
    {status ? <div role="status" className="grid gap-2 border border-line bg-panel p-3"><p>{status.state === "live" && audioMode === "chat" ? s.chatOnlyLive : s[status.state]}</p>
      <p>{s.received}: {status.received}{chat || status.sent || status.pending ? ` · ${s.sent}: ${status.sent} · ${s.pending}: ${status.pending}` : ""}</p></div> : null}
    {owner && audioMode !== "transcript" && audioMode !== "chat" && status ? <section className="grid min-w-0 gap-2 border border-line p-3" aria-label={s.speakers}>
      <p>{s.speakers}</p>
      {status.speakers.length ? status.speakers.map((speaker) => <label key={speaker.key} className="grid min-w-0 gap-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)] sm:items-center">
        <span className="break-words">{speaker.key === "mixed" ? s.mixedSpeaker : speaker.name || speaker.key}{speaker.active ? " ●" : ""}</span>
        {audioMode === "speakers" ? <select className={field} value={speaker.lang ?? ""} onChange={(event) => {
          const lang = event.target.value || null;
          void zoomRequest("POST", { action: "assign", owner, speaker: speaker.key, lang }).catch(() => setError("requestFailed"));
        }}>
          <option value="">{s.speakerAuto}</option>
          {languages.filter((lang) => targets.includes(lang.code)).map((lang) => <option key={lang.code} value={lang.code}>{lang.nativeName}</option>)}
        </select> : null}
      </label>) : <p className="text-muted">{s.speakersEmpty}</p>}
    </section> : null}
    {error ? <p role="alert">{errorText(s, error)}</p> : null}
  </section>;
}
