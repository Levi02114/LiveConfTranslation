"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { copyText } from "@/lib/clipboard";
import { desktopStateSchema, type DesktopAction, type DesktopState } from "@/lib/desktop-control";
import type { AdminStrings, UiStrings } from "@/lib/i18n-builtin";
import type { Language } from "@/lib/languages";
import type { SecurityLimits } from "@/lib/security-limits";
import type { EngineId } from "@/lib/translate/types";
import type { VoiceSettings } from "@/lib/voice-settings";
import { EngineKeysDialog, type EngineKeyStatus } from "./engine-keys-dialog";
import { GoogleSpeechDialog, type GoogleSpeechStatus } from "./google-speech-dialog";
import { OpenaiUsageDialog } from "./openai-usage-dialog";
import { PasswordChangeDialog } from "./password-change-dialog";
import { SecuritySettings } from "./security-settings";
import { TranslationJobs } from "./translation-jobs";
import { VoiceSettingsForm } from "./voice-settings";

const desktopResponse = z.object({ desktop: desktopStateSchema.nullable().optional(), writable: z.boolean().optional(), error: z.string().optional(), link: z.string().url().optional() });
type Section = "connection" | "api" | "telegram" | "security" | "voice" | "help";
type Props = { strings: AdminStrings; ui: UiStrings; languages: Language[];
  engines: { id: EngineId; label: string; configured: boolean }[]; keys: EngineKeyStatus[];
  google: GoogleSpeechStatus; usage: GoogleSpeechStatus; limits: SecurityLimits; voice: VoiceSettings; meetings: { id: string; title: string }[] };

export function AppSettings(props: Props) {
  const { strings } = props;
  const s = strings.appSettings;
  const pathname = usePathname();
  const router = useRouter();
  const visible = pathname === "/admin" || /^\/admin\/meetings\/[^/]+\/?$/.test(pathname);
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<Section>("connection");
  const dialog = useRef<HTMLDialogElement>(null);
  const [desktop, setDesktop] = useState<DesktopState | null>(null);
  const [writable, setWritable] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const show = () => setOpen(true);
    const close = () => dialog.current?.close();
    window.addEventListener("lct-open-settings", show);
    window.addEventListener("lct-admin-disconnected", close);
    return () => { window.removeEventListener("lct-open-settings", show); window.removeEventListener("lct-admin-disconnected", close); };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    let disposed = false;
    const controller = new AbortController();
    const refresh = async () => {
      try {
        const response = await fetch("/api/admin/desktop", { cache: "no-store", signal: controller.signal });
        if (response.status === 401) { dialog.current?.close(); router.replace("/admin/login"); return; }
        const parsed = desktopResponse.safeParse(await response.json());
        if (!response.ok || !parsed.success) throw new Error();
        if (disposed) return;
        setDesktop(parsed.data.desktop ?? null); setWritable(parsed.data.writable === true); setLoadFailed(false);
        if (parsed.data.desktop) {
          localStorage.setItem("lct_public_origin", parsed.data.desktop.origin);
          window.dispatchEvent(new Event("lct-public-origin"));
        }
      } catch { if (!disposed) setLoadFailed(true); }
    };
    void refresh();
    window.addEventListener("lct-app-settings", refresh);
    window.addEventListener("focus", refresh);
    return () => { disposed = true; controller.abort(); window.removeEventListener("lct-app-settings", refresh); window.removeEventListener("focus", refresh); };
  }, [router, visible]);
  useEffect(() => {
    if (!visible || !open) return;
    dialog.current?.showModal();
    if (dialog.current) dialog.current.scrollTop = 0;
  }, [open, visible]);
  useEffect(() => {
    if (!visible) return;
    if (new URLSearchParams(window.location.search).get("settings") === "security") {
      const timer = setTimeout(() => { setSection("security"); setOpen(true); }, 0);
      return () => clearTimeout(timer);
    }
  }, [visible]);
  if (!visible) return null;
  const tabs: { id: Section; label: string }[] = [
    { id: "connection", label: s.connection }, { id: "api", label: s.api },
    { id: "telegram", label: "Telegram" }, { id: "security", label: s.security },
    { id: "voice", label: s.voice }, { id: "help", label: strings.operations.appGuide },
  ];
  return <>
    <dialog ref={dialog} onClose={() => { setOpen(false); router.refresh(); }} aria-labelledby="app-settings-title"
      className="app-settings-panel fixed inset-y-0 left-0 m-0 h-dvh max-h-dvh w-full max-w-full overflow-y-auto border-r border-line bg-bg p-4 text-fg backdrop:bg-black/45 sm:w-[min(48rem,90vw)] sm:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <h1 id="app-settings-title">{s.title}</h1><button onClick={() => dialog.current?.close()}>{strings.keys.close}</button>
      </header>
      <nav aria-label={s.title} className="my-4 flex flex-wrap gap-2">{tabs.map((tab) => <button key={tab.id}
        aria-pressed={section === tab.id} onClick={() => setSection(tab.id)}>{tab.label}</button>)}</nav>
      {open ? <SettingsBody key={section} {...props} section={section} desktop={desktop} writable={writable}
        loadFailed={loadFailed} onDesktop={setDesktop} onClose={() => dialog.current?.close()} /> : null}
    </dialog>
  </>;
}

function SettingsBody({ section, desktop, writable, loadFailed, onDesktop, onClose, ...props }: Props & {
  section: Section; desktop: DesktopState | null; writable: boolean; loadFailed: boolean;
  onDesktop: (state: DesktopState) => void; onClose: () => void;
}) {
  const { strings, ui } = props;
  const s = strings.appSettings;
  const t = strings.operations;
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [notice, setNotice] = useState("");
  const [token, setToken] = useState("");
  const [link, setLink] = useState("");
  const [meetingId, setMeetingId] = useState("");
  const [tunnelMode, setTunnelMode] = useState<"named" | "external">(desktop?.connection?.mode === "external" ? "external" : "named");
  const [tunnelOrigin, setTunnelOrigin] = useState(desktop?.connection?.configuredOrigin ?? "");
  const [tunnelToken, setTunnelToken] = useState("");
  const n = strings.tunnel;
  const run = async (action: DesktopAction) => {
    if (busyRef.current || !writable) return;
    if (action.action === "stop" && !window.confirm(s.stopWarning)) return;
    if (action.action === "tunnel-apply" && !window.confirm(n.confirm)) return;
    if (action.action === "tunnel-base" && !window.confirm(s.stopWarning)) return;
    busyRef.current = true; setBusy(true); setNotice(""); setLink("");
    try {
      const response = await fetch("/api/admin/desktop", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(action) });
      const parsed = desktopResponse.safeParse(await response.json());
      if (!response.ok || !parsed.success || parsed.data.error) {
        const error = parsed.success ? parsed.data.error : undefined;
        setNotice(Object.entries({ ...t, ...n }).find(([key]) => key === error)?.[1] ?? t.genericError);
        return;
      }
      if (parsed.data.desktop) {
        onDesktop(parsed.data.desktop);
        localStorage.setItem("lct_public_origin", parsed.data.desktop.origin);
        window.dispatchEvent(new Event("lct-public-origin"));
      }
      setTunnelToken("");
      if (parsed.data.link) setLink(parsed.data.link);
      setToken("");
      setNotice(action.action === "stop" ? s.stopRequested : action.action === "test" ? t.testSent : strings.security.saved);
    } catch { setNotice(t.genericError); }
    finally { busyRef.current = false; setBusy(false); }
  };
  if (section === "voice") return <VoiceSettingsForm initial={props.voice} {...props} />;
  if (section === "api") return <>
    <EngineKeysDialog inline strings={strings.keys} initial={props.keys} engines={props.engines.filter((engine) => engine.id !== "local")}
      onChange={(status) => window.dispatchEvent(new CustomEvent("lct-engine-keys", { detail: status }))} />
    <GoogleSpeechDialog inline strings={strings.speechCredentials} initial={props.google} />
    <OpenaiUsageDialog inline strings={strings.openaiUsage} initial={props.usage} />
  </>;
  if (section === "security") return <>
    <PasswordChangeDialog inline strings={strings.passwordChange} />
    <SecuritySettings initial={props.limits} strings={strings.security} />
    <label>{strings.security.jobSession}<select value={meetingId} onChange={(event) => setMeetingId(event.target.value)}>
      <option value="">{strings.security.chooseSession}</option>{props.meetings.map((meeting) => <option key={meeting.id} value={meeting.id}>{meeting.title}</option>)}
    </select></label>{meetingId ? <TranslationJobs key={meetingId} meetingId={meetingId} strings={strings.security} /> : null}
  </>;
  if (section === "help") return <button onClick={() => { onClose(); window.dispatchEvent(new Event("lct-app-guide")); }}>{t.appGuide}</button>;
  if (loadFailed) return <p role="alert">{strings.security.failed}</p>;
  if (!desktop) return <p>{s.unavailable}</p>;
  const telegram = desktop.telegram;
  return <section className="grid gap-4">
    {!writable ? <p>{s.insecure}</p> : null}
    {section === "connection" ? <>
      {desktop.connection ? <fieldset disabled={!writable || busy || desktop.connection.busy} className="grid min-w-0 gap-3 border border-line p-3">
        <legend>{n.mode}: {n[desktop.connection.mode]}</legend>
        <a href="https://developers.cloudflare.com/tunnel/get-started/" target="_blank" rel="noreferrer">{n.setup}</a>
        <label>{n.mode}<select value={tunnelMode} onChange={(event) => setTunnelMode(event.target.value === "external" ? "external" : "named")}>
          <option value="named">{n.named}</option><option value="external">{n.external}</option>
        </select></label>
        <label>{n.origin}<input type="url" autoComplete="off" maxLength={300} value={tunnelOrigin} onChange={(event) => setTunnelOrigin(event.target.value)} /></label>
        {tunnelMode === "named" ? <>
          <label>{n.token}<input type="password" autoComplete="new-password" maxLength={4096} value={tunnelToken} onChange={(event) => setTunnelToken(event.target.value)} /></label>
          <p>{n.tokenHelp}</p>
        </> : null}
        <div className="flex flex-wrap gap-2">
          <button disabled={!tunnelOrigin.trim() || (tunnelMode === "named" && !tunnelToken.trim() && !desktop.connection.hasToken)}
            onClick={() => void run({ action: "tunnel-check", mode: tunnelMode, origin: tunnelOrigin, token: tunnelToken })}>{n.check}</button>
          <button onClick={() => void run({ action: "tunnel-base", confirmed: true })}>{n.restore} ({n[desktop.connection.baseMode]})</button>
        </div>
        {desktop.connection.pending ? <div className="grid gap-2 border-t border-line pt-3">
          <p>{n.verified}</p><p className="break-all">{desktop.connection.pending.origin}</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void run({ action: "tunnel-apply", id: desktop.connection!.pending!.id, confirmed: true })}>{n.apply}</button>
            <button onClick={() => void run({ action: "tunnel-cancel" })}>{n.cancel}</button>
          </div>
        </div> : null}
        <p>{n.retain}</p>
      </fieldset> : null}
      <label>{s.share}<select disabled={!writable || busy} value={desktop.addresses.some((item) => item.origin === desktop.origin) ? desktop.origin : ""}
        onChange={(event) => void run({ action: "share", origin: event.target.value })}>
        <option value="" disabled>{desktop.origin}</option>
        {desktop.addresses.map((address) => <option key={address.origin} value={address.origin}>{address.label}</option>)}
      </select></label>
      <p className="break-all">{desktop.origin}</p>
      <p>{desktop.tunnel === "connected" ? t.tunnelStatusConnected : desktop.tunnel === "connecting" ? t.tunnelStatusConnecting : desktop.tunnel === "recovering" ? t.tunnelStatusRecovering : t.tunnelStatusOff}</p>
      <div className="flex flex-wrap gap-2">
        <button disabled={!writable || busy || desktop.externalTunnel || desktop.tunnel !== "off"} onClick={() => void run({ action: "start" })}>{t.tunnelStart}</button>
        <button onClick={async () => setNotice(await copyText(desktop.origin) ? t.copied : t.genericError)}>{strings.dashboard.copy}</button>
        <a href={desktop.origin} target="_blank" rel="noreferrer">{t.tunnelOpen}</a>
        <button disabled={!writable || busy || desktop.externalTunnel || desktop.tunnel === "off"} onClick={() => void run({ action: "stop", confirmed: true })}>{t.tunnelStop}</button>
      </div>
      {desktop.ca ? <a href="/local-ca.cer" download>{s.ca}</a> : null}
      {desktop.connection?.mode !== "named" ? <p>{t.quickTunnelNotice}</p> : null}
      {desktop.externalTunnel ? <p>{s.externalTunnel}</p> : null}
    </> : <>
      <p>{t.botFatherHelp}</p><a href="https://t.me/BotFather" target="_blank" rel="noreferrer">{t.openBotFather}</a>
      <label>{t.tokenLabel}<input type="password" autoComplete="off" value={token} onChange={(event) => setToken(event.target.value)} disabled={!writable || busy} /></label>
      <button disabled={!writable || busy || !token.trim()} onClick={() => void run({ action: "verify", token })}>{t.verifyBot}</button>
      <p>{t.tokenSecurity}</p>{telegram.bot ? <p>{t.verifiedBot}: {telegram.bot.name} (@{telegram.bot.username})</p> : null}
      <p>{telegram.receiver === "ready" ? t.receiverReady : telegram.receiver === "conflict" ? t.pollingConflict : telegram.receiver === "invalid-token" ? t.invalidToken : t.receiverWaiting}</p>
      <button disabled={!writable || busy} onClick={() => void run({ action: "retry" })}>{t.retryReceiver}</button>
      <p>{t.connectHelp}</p><div className="flex flex-wrap gap-2">
        <button disabled={!writable || busy || !telegram.bot} onClick={() => void run({ action: "pair", mode: "private" })}>{t.connectPrivate}</button>
        <button disabled={!writable || busy || !telegram.bot} onClick={() => void run({ action: "pair", mode: "group" })}>{t.connectGroup}</button>
      </div>
      {link ? <a href={link} target="_blank" rel="noreferrer">{t.connectPrivate} / {t.connectGroup}</a> : null}
      <h2>{t.recipients}</h2>{!telegram.chats.length ? <p>{t.noRecipients}</p> : null}
      {telegram.chats.map((chat) => <div key={chat.id} className="grid gap-2 border border-line p-3">
        <p>{chat.title} · {chat.type === "private" ? t.privateChat : t.groupChat}</p>
        <div className="flex flex-wrap gap-2"><button disabled={!writable || busy} onClick={() => void run({ action: "test", chatId: chat.id })}>{t.test}</button>
          <button disabled={!writable || busy} onClick={() => void run({ action: "remove", chatId: chat.id })}>{t.remove}</button></div>
        {chat.type === "private" ? <label><input type="checkbox" disabled={!writable || busy} checked={chat.managementEnabled === true}
          onChange={(event) => void run({ action: "management", chatId: chat.id, enabled: event.target.checked })} /> {t.managePermission}</label> : null}
      </div>)}
    </>}
    <label><input type="checkbox" checked={desktop.connection?.auto ?? telegram.autoTunnel} disabled={!writable || busy || desktop.connection?.busy || desktop.externalTunnel} onChange={(event) => void run({ action: "auto", enabled: event.target.checked })} /> {t.autoLabel}</label>
    <p>{desktop.connection?.mode === "named" ? n.autoHelp : t.autoHelp}</p><p role="status">{busy ? ui.capture.starting : notice}</p>
  </section>;
}
