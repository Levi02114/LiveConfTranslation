"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useRef, useState, useSyncExternalStore, useTransition } from "react";

import { AppearanceControls } from "@/components/appearance-controls";
import { copyText } from "@/lib/clipboard";
import { useSetAdminLang } from "@/hooks/use-admin-lang";
import { useRealtime } from "@/hooks/use-realtime";
import type { AdminStrings, UiStrings } from "@/lib/i18n-builtin";
import type { Language, LanguageCode } from "@/lib/languages";
import { formatClock, formatTimestamp } from "@/lib/log-format";
import type { ServerMessage } from "@/lib/realtime/protocol";
import type {
  CombinedEntry,
  Meeting,
  MeetingLanguageConfig,
  Page,
} from "@/lib/repo";

import { AdminBusyOverlay } from "../../admin-busy-overlay";
import { TranscriptionContextSettings } from "./session-settings";

/** 실시간 번역에 남겨 둘 줄 수. 대시보드는 기록이 아니라 감시용이다. */
const FLOW_LIMIT = 60;

const PUBLIC_ORIGIN_KEY = "lct_public_origin";
const subscribeOrigin = (onStoreChange: () => void) => {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener("lct-public-origin", onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener("lct-public-origin", onStoreChange);
  };
};
const getOrigin = () => localStorage.getItem(PUBLIC_ORIGIN_KEY) ?? window.location.origin;
const getServerOrigin = () => "";

type Flow = {
  key: string;
  messageId: number;
  revision: number;
  editedAt: number | null;
  at: number;
  route: string;
  body: string;
  status: "source" | "done" | "failed";
};

export function DashboardView({
  meeting,
  languages,
  pages,
  languageConfigs,
  history,
  coverage,
  fallbackCoverage,
  lang,
  strings,
  ui,
  displayLanguages,
}: {
  meeting: Meeting;
  languages: Language[];
  pages: Page[];
  languageConfigs: MeetingLanguageConfig[];
  history: CombinedEntry[];
  coverage: { engine: string; label: string; configured: boolean; unsupported: LanguageCode[] };
  fallbackCoverage: {
    engine: string;
    label: string;
    configured: boolean;
    unsupported: LanguageCode[];
  } | null;
  lang: LanguageCode;
  strings: AdminStrings;
  ui: UiStrings;
  displayLanguages: Language[];
}) {
  const [closed, setClosed] = useState(meeting.status === "closed");
  const [closedAt, setClosedAt] = useState<number | null>(meeting.closedAt);
  const [flows, setFlows] = useState<Flow[]>(() => seedFlows(history, languages, ui.status.failed));
  const [copied, setCopied] = useState<{ key: string; ok: boolean } | null>(null);
  const [qr, setQr] = useState<{ dataUrl: string; fileName: string } | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const qrDialogRef = useRef<HTMLDialogElement>(null);
  const setLang = useSetAdminLang();
  const [navigating, startNavigation] = useTransition();

  // 참석자에게 나눠 줄 URL 은 절대 주소여야 한다. 서버는 접속자가 어느 주소로
  // 들어왔는지 모르므로(로컬 IP·호스트명 제각각) 브라우저에서 읽는다.
  // Electron 이 Quick Tunnel을 켜면 공개 주소로 즉시 교체한다.
  const origin = useSyncExternalStore(subscribeOrigin, getOrigin, getServerOrigin);

  const nameOf = useCallback(
    (code: LanguageCode) =>
      languages.find((language) => language.code === code)?.label ?? code,
    [languages],
  );

  const onMessage = useCallback(
    (message: ServerMessage) => {
      if (message.t === "message") {
        setFlows((prev) => {
          const current = prev.find((flow) => flow.key === `m${message.messageId}`);
          const cleared = !current || message.revision <= current.revision
            ? prev
            : prev.filter((flow) => flow.messageId !== message.messageId || flow.status === "source");
          return push(cleared, {
            key: `m${message.messageId}`,
            messageId: message.messageId,
            revision: message.revision,
            editedAt: message.editedAt,
            at: message.createdAt,
            route: nameOf(message.lang),
            body: withSpeaker(message.body, message.speakerName),
            status: "source",
          });
        });
      } else if (message.t === "translation") {
        setFlows((prev) =>
          push(prev, {
            key: `t${message.messageId}-${message.lang}`,
            messageId: message.messageId,
            revision: message.revision,
            editedAt: message.editedAt,
            at: message.createdAt,
            route: `→ ${nameOf(message.lang)}`,
            body: withSpeaker(
              message.status === "ok" ? message.body : ui.status.failed,
              message.speakerName,
            ),
            status: message.status === "ok" ? "done" : "failed",
          }),
        );
      } else if (message.t === "meeting-closed") {
        setClosed(true);
        setClosedAt(message.closedAt);
      }
    },
    [nameOf, ui.status.failed],
  );

  useRealtime(`meeting=${encodeURIComponent(meeting.id)}`, onMessage);

  const close = async () => {
    if (closing) return;
    setClosing(true);
    setCloseError(null);
    try {
      const response = await fetch(`/api/meetings/${meeting.id}`, { method: "POST" });
      if (!response.ok) {
        setCloseError(strings.list.closeFailed);
        return;
      }
      setClosed(true);
      setClosedAt(Date.now());
    } catch {
      setCloseError(strings.list.closeFailed);
    } finally {
      setClosing(false);
    }
  };

  const copy = async (key: string, url: string) => {
    // 실패해도 사용자에게 알린다. 조용히 아무 일도 안 하면 눌렀는지조차 모른다.
    const ok = await copyText(url);
    setCopied({ key, ok });
    setTimeout(
      () => setCopied((current) => (current?.key === key ? null : current)),
      ok ? 1200 : 2500,
    );
  };

  const openLog = () => {
    window.open(
      `/admin/meetings/${meeting.id}/log`,
      `log-${meeting.id}`,
      "width=820,height=760,noopener",
    );
  };

  const showQr = async (key: string, url: string) => {
    setQr(null);
    setQrError(null);
    qrDialogRef.current?.showModal();

    try {
      const { toDataURL } = await import("qrcode");
      setQr({
        dataUrl: await toDataURL(url, { width: 320, margin: 2 }),
        fileName: `${key}-qr.png`,
      });
    } catch {
      setQrError(strings.dashboard.qrFailed);
    }
  };

  const inputPages = new Map(
    pages.filter((page) => page.kind === "input" && page.lang).map((page) => [page.lang, page]),
  );
  const outputPages = new Map(
    pages.filter((page) => page.kind === "output" && page.lang).map((page) => [page.lang, page]),
  );
  const combined = pages.find((page) => page.kind === "combined");
  const combinedInput = pages.find((page) => page.kind === "combined-input");
  const capturePages = new Map(
    pages.filter((page) => page.kind === "capture" && page.lang).map((page) => [page.lang, page]),
  );
  const configByLanguage = new Map(languageConfigs.map((row) => [row.lang, row]));
  const hasOutput = languageConfigs.some((row) => row.outputEnabled);

  const copyBtn =
    "min-h-9 shrink-0 cursor-pointer whitespace-nowrap border border-line px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:bg-fg hover:text-bg sm:min-h-0";

  return (
    <div lang={lang} className="mx-auto max-w-[980px] px-4 pt-20 pb-12 sm:px-8 sm:pb-16">
      <AdminBusyOverlay
        label={closing ? strings.list.closingSession : navigating ? strings.list.loading : null}
      />
      <AppearanceControls
        strings={ui.appearance}
        language={{
          value: lang,
          label: strings.language.label,
          options: displayLanguages,
          onChange: (next) => startNavigation(() => setLang(next)),
        }}
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link
          href="/admin"
          prefetch={false}
          aria-label={strings.dashboard.backToAdmin}
          title={strings.dashboard.backToAdmin}
          className="inline-flex h-8 w-8 items-center justify-center font-mono text-[22px] text-muted transition-colors hover:text-fg"
        >
          ←
        </Link>
        <button
          type="button"
          onClick={openLog}
          className="cursor-pointer border border-line px-3 py-2 font-mono text-[12px] text-muted transition-colors hover:border-fg hover:bg-fg hover:text-bg"
        >
          {strings.dashboard.log}
        </button>
        <span className="font-mono text-[11px] text-muted">{strings.dashboard.popup}</span>
      </div>

      <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-5">
        <div className="min-w-0">
          <div className="text-[26px] font-medium break-words">{meeting.title}</div>
          <div className="mt-1.5 font-mono text-[12px] text-muted">
            {languages.map((language) => language.label).join(" · ")} ·{" "}
            {strings.list.engine}: {coverage.label}
            {coverage.configured ? "" : ` (${strings.list.engineNoKey})`}
            {" · "}
            {strings.list.fallbackEngine}:{" "}
            {fallbackCoverage ? fallbackCoverage.label : strings.list.noFallback}
            {fallbackCoverage && !fallbackCoverage.configured
              ? ` (${strings.list.engineNoKey})`
              : ""}
            {" · "}
            {strings.list.transcriptionProvider}: {meeting.transcriptionProvider === "local" ? strings.list.transcriptionLocal : strings.list.transcriptionOpenai}
          </div>
        </div>
        {closed ? (
          <div className="shrink-0 font-mono text-[12px] text-muted">{strings.list.closed}</div>
        ) : (
          <button
            type="button"
            onClick={() => void close()}
            disabled={closing}
            className="shrink-0 cursor-pointer border border-line px-4 py-2 font-mono text-[13px] transition-colors hover:border-fg hover:bg-fg hover:text-bg disabled:cursor-default disabled:opacity-30"
          >
            {closing ? strings.list.closingSession : strings.dashboard.close}
          </button>
        )}
      </div>

      {closed ? (
        <div className="mt-4 border border-line px-4 py-3 font-mono text-[13px] text-muted">
          {strings.dashboard.closedNotice}
          {closedAt ? ` · ${formatTimestamp(closedAt)}` : ""}
        </div>
      ) : null}

      {closeError ? <div className="mt-4 font-mono text-[12px]">{closeError}</div> : null}

      <TranscriptionContextSettings
        meetingId={meeting.id}
        initialContext={meeting.transcriptionContext}
        strings={strings}
      />

      {coverage.unsupported.length ? (
        <div className="mt-4 border border-line px-4 py-3 font-mono text-[12px] text-muted">
          {strings.dashboard.unsupportedEngine
            .replace("{engine}", coverage.label)
            .replace("{languages}", coverage.unsupported.map(nameOf).join(" · "))
            .replace(
              "{fallback}",
              fallbackCoverage?.label ?? strings.list.noFallback,
            )}
        </div>
      ) : null}

      <section className="mt-10">
        <div className="mb-1 font-mono text-[11px] text-muted">{strings.dashboard.pages}</div>
        <div
          className={`hidden gap-x-5 gap-y-3 border-b border-line py-3 font-mono text-[11px] text-muted lg:grid ${
            "grid-cols-[110px_1fr_1fr]"
          }`}
        >
          <div>{strings.list.languages}</div>
          <div>
            {meeting.inputMode === "human" ? strings.settings.input : strings.dashboard.capture}
          </div>
          <div>{strings.settings.output}</div>
        </div>

        {languages.map((language) => {
          const input = inputPages.get(language.code);
          const capture = capturePages.get(language.code);
          const output = outputPages.get(language.code);
          const config = configByLanguage.get(language.code);
          return (
            <div
              key={language.code}
              className={`grid grid-cols-1 gap-4 border-b border-line py-4 lg:items-center lg:gap-x-5 lg:gap-y-3 lg:py-3.5 ${
                "lg:grid-cols-[110px_1fr_1fr]"
              }`}
            >
              <div className="text-[15px]">{language.label}</div>
              {meeting.inputMode === "human" ? (
                <UrlCell
                  url={config?.inputEnabled && input ? `${origin}/in/${input.token}` : ""}
                  copied={copied?.key === `in-${language.code}` ? copied : null}
                  onCopy={(url) => void copy(`in-${language.code}`, url)}
                  className={copyBtn}
                  strings={strings.dashboard}
                  label={strings.settings.input}
                  onQr={(url) => void showQr(`input-${language.code}`, url)}
                />
              ) : (
                <UrlCell
                  url={config?.inputEnabled && capture ? `${origin}/capture/${capture.token}` : ""}
                  copied={copied?.key === `capture-${language.code}` ? copied : null}
                  onCopy={(url) => void copy(`capture-${language.code}`, url)}
                  className={copyBtn}
                  strings={strings.dashboard}
                  label={strings.dashboard.capture}
                  onQr={(url) => void showQr(`capture-${language.code}`, url)}
                />
              )}
              <UrlCell
                url={config?.outputEnabled && output ? `${origin}/out/${output.token}` : ""}
                copied={copied?.key === `out-${language.code}` ? copied : null}
                onCopy={(url) => void copy(`out-${language.code}`, url)}
                className={copyBtn}
                strings={strings.dashboard}
                label={strings.settings.output}
                onQr={(url) => void showQr(`output-${language.code}`, url)}
              />
            </div>
          );
        })}

        {combined ? (
          <>
            <div className="grid grid-cols-1 gap-3 border-b border-line py-4 lg:grid-cols-[110px_1fr] lg:items-center lg:gap-x-5 lg:py-3.5">
              <div className="text-[15px]">{ui.role.combined}</div>
              <UrlCell
                url={`${origin}/all/${combined.token}`}
                copied={copied?.key === "all" ? copied : null}
                onCopy={(url) => void copy("all", url)}
                className={copyBtn}
                strings={strings.dashboard}
                onQr={(url) => void showQr("combined", url)}
              />
            </div>
            {hasOutput ? (
              <div className="grid grid-cols-1 gap-3 border-b border-line py-4 lg:grid-cols-[110px_1fr] lg:items-center lg:gap-x-5 lg:py-3.5">
                <div className="text-[15px]">{strings.dashboard.participantGuide}</div>
                <UrlCell
                  url={`${origin}/join/${combined.token}`}
                  copied={copied?.key === "join" ? copied : null}
                  onCopy={(url) => void copy("join", url)}
                  className={copyBtn}
                  strings={strings.dashboard}
                  onQr={(url) => void showQr("participant-guide", url)}
                />
              </div>
            ) : null}
          </>
        ) : null}
        {combinedInput ? (
          <div className="grid grid-cols-1 gap-3 border-b border-line py-4 lg:grid-cols-[110px_1fr] lg:items-center lg:gap-x-5 lg:py-3.5">
            <div className="text-[15px]">{ui.role.combinedInput}</div>
            <UrlCell
              url={`${origin}/in/all/${combinedInput.token}`}
              copied={copied?.key === "combined-input" ? copied : null}
              onCopy={(url) => void copy("combined-input", url)}
              className={copyBtn}
              strings={strings.dashboard}
              onQr={(url) => void showQr("combined-input", url)}
            />
          </div>
        ) : null}
      </section>

      <section className="mt-12">
        <div className="mb-1 font-mono text-[11px] text-muted">{strings.dashboard.live}</div>
        {flows.length === 0 ? (
          <p className="py-4 font-mono text-[12px] text-muted">{ui.status.noContent}</p>
        ) : null}
        {flows.map((flow) => (
          <div
            key={flow.key}
            className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-baseline gap-x-3 gap-y-1 border-t border-line py-3 sm:gap-3.5 sm:py-2.5 xl:grid-cols-[auto_auto_minmax(0,1fr)_auto]"
          >
            <div className="col-start-1 row-start-1 font-mono text-[12px] text-muted">
              {formatClock(flow.at)}
            </div>
            <div className="col-start-2 row-start-1 truncate font-mono text-[12px] xl:max-w-[10rem]">
              {flow.route}
            </div>
            <div className="app-text col-start-2 col-end-4 row-start-2 [text-wrap:pretty] xl:col-start-3 xl:col-end-4 xl:row-start-1">
              {flow.body}
              {flow.editedAt ? (
                <span className="mt-1 block font-mono text-[11px] text-muted">
                  ({ui.message.edited})
                </span>
              ) : null}
            </div>
            <div
              className={`col-start-3 row-start-1 font-mono text-[11px] xl:col-start-4 ${flow.status === "failed" ? "text-fg" : "text-muted"}`}
            >
              {strings.dashboard[flow.status]}
            </div>
          </div>
        ))}
      </section>

      <dialog
        ref={qrDialogRef}
        onClose={() => {
          setQr(null);
          setQrError(null);
        }}
        className="m-auto w-[min(380px,calc(100vw-32px))] border border-line bg-bg p-0 text-fg backdrop:bg-black/45"
      >
        <div className="p-6">
          <div className="flex min-h-[320px] items-center justify-center bg-fg">
            {qr ? (
              <Image
                unoptimized
                src={qr.dataUrl}
                width={320}
                height={320}
                alt="QR"
                className="h-auto w-full"
              />
            ) : (
              <span className="font-mono text-[12px] text-bg">{qrError ?? "…"}</span>
            )}
          </div>
          <div className="mt-4 flex items-center justify-end gap-3">
            {qr ? (
              <a
                href={qr.dataUrl}
                download={qr.fileName}
                className={copyBtn}
              >
                {strings.dashboard.downloadQr}
              </a>
            ) : null}
            <button
              type="button"
              onClick={() => qrDialogRef.current?.close()}
              className={copyBtn}
            >
              {strings.dashboard.closeQr}
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}

function UrlCell({
  url,
  copied,
  onCopy,
  className,
  strings,
  label,
  onQr,
}: {
  url: string;
  copied: { key: string; ok: boolean } | null;
  onCopy: (url: string) => void;
  className: string;
  strings: AdminStrings["dashboard"];
  label?: string;
  onQr: (url: string) => void;
}) {
  return (
    <div className="min-w-0">
      {label ? <div className="mb-1.5 font-mono text-[11px] text-muted lg:hidden">{label}</div> : null}
      <div className="flex min-w-0 flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-2.5">
        {/*
          복사가 막힌 환경에서도 주소를 직접 긁어 갈 수 있어야 한다.
          말줄임으로 잘려 보여도 선택하면 전체가 잡히도록 title 에 원문을 둔다.
        */}
        <span
          className="block max-w-full truncate font-mono text-[12px] text-muted select-all"
          title={url}
        >
          {url || "—"}
        </span>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <button type="button" disabled={!url} onClick={() => onCopy(url)} className={className}>
            {copied ? (copied.ok ? strings.copied : strings.copyFailed) : strings.copy}
          </button>
          <button
            type="button"
            disabled={!url}
            onClick={() => window.open(url, "_blank", "noopener,noreferrer")}
            className={className}
          >
            {strings.openNew}
          </button>
          <button type="button" disabled={!url} onClick={() => onQr(url)} className={className}>
            {strings.showQr}
          </button>
        </div>
      </div>
    </div>
  );
}

function push(prev: Flow[], next: Flow): Flow[] {
  const index = prev.findIndex((flow) => flow.key === next.key);
  if (index >= 0) {
    if (prev[index]!.revision > next.revision) return prev;
    const updated = prev.slice();
    updated[index] = next;
    return updated;
  }
  return [next, ...prev].slice(0, FLOW_LIMIT);
}

/** 대시보드를 늦게 열어도 직전 흐름이 보이도록 지난 기록을 같은 모양으로 편다. */
function seedFlows(history: CombinedEntry[], languages: Language[], failedText: string): Flow[] {
  const nameOf = (code: LanguageCode) =>
    languages.find((language) => language.code === code)?.label ?? code;

  const flows: Flow[] = [];
  for (const entry of history) {
    flows.push({
      key: `m${entry.messageId}`,
      messageId: entry.messageId,
      revision: entry.revision,
      editedAt: entry.editedAt,
      at: entry.createdAt,
      route: nameOf(entry.sourceLang),
      body: withSpeaker(entry.sourceBody, entry.speakerName),
      status: "source",
    });
    for (const translation of entry.translations) {
      flows.push({
        key: `t${entry.messageId}-${translation.lang}`,
        messageId: entry.messageId,
        revision: entry.revision,
        editedAt: entry.editedAt,
        at: entry.createdAt,
        route: `→ ${nameOf(translation.lang)}`,
        body: withSpeaker(
          translation.status === "ok" ? translation.body : failedText,
          entry.speakerName,
        ),
        status: translation.status === "ok" ? "done" : "failed",
      });
    }
  }
  return flows.slice(-FLOW_LIMIT).reverse();
}

function withSpeaker(body: string, speakerName: string | null): string {
  return speakerName ? `(${speakerName}) ${body}` : body;
}
