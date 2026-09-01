"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { z } from "zod";

import { AppearanceControls } from "@/components/appearance-controls";
import { generateQr, QrDialog, type QrImage } from "@/components/qr-dialog";
import { copyText } from "@/lib/clipboard";
import { useSetAdminLang } from "@/hooks/use-admin-lang";
import { usePublicOrigin } from "@/hooks/use-public-origin";
import type { AdminStrings, UiStrings } from "@/lib/i18n-builtin";
import type { Language, LanguageCode } from "@/lib/languages";
import { formatTimestamp } from "@/lib/log-format";
import type {
  Meeting,
  MeetingLanguageConfig,
  Page,
} from "@/lib/repo";

import { AdminBusyOverlay } from "../../admin-busy-overlay";
import { MinutesDownloadButtons } from "./minutes-download-dialog";
import { TranscriptionContextSettings } from "./session-settings";

const participantResponseSchema = z.object({
  participants: z.array(z.object({
    participantId: z.string(),
    speakerName: z.string().nullable(),
    lang: z.string().nullable(),
    ip: z.string(),
    microphoneOn: z.boolean(),
  })),
});
type Participant = z.infer<typeof participantResponseSchema>["participants"][number];

export function DashboardView({
  meeting,
  languages,
  pages,
  languageConfigs,
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
  const [copied, setCopied] = useState<{ key: string; ok: boolean } | null>(null);
  const [qr, setQr] = useState<QrImage | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [stoppingVoice, setStoppingVoice] = useState<string | null>(null);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const qrDialogRef = useRef<HTMLDialogElement>(null);
  const setLang = useSetAdminLang();
  const [navigating, startNavigation] = useTransition();

  // 참석자에게 나눠 줄 URL 은 절대 주소여야 한다. 서버는 접속자가 어느 주소로
  // 들어왔는지 모르므로(로컬 IP·호스트명 제각각) 브라우저에서 읽는다.
  // Electron 이 Quick Tunnel을 켜면 공개 주소로 즉시 교체한다.
  const origin = usePublicOrigin();

  const nameOf = (code: LanguageCode) =>
    languages.find((language) => language.code === code)?.label ?? code;
  const participantLabel = (participant: Participant) => {
    const language = participant.lang ? nameOf(participant.lang) : ui.input.autoLanguage;
    return meeting.speakerLabels && participant.speakerName
      ? `${participant.speakerName} · ${language}`
      : `${language} · ${participant.ip}`;
  };

  useEffect(() => {
    if (closed) return;

    let disposed = false;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/meetings/${meeting.id}/voice-status`, {
          cache: "no-store",
        });
        const payload = participantResponseSchema.safeParse(await response.json());
        if (!disposed && response.ok && payload.success) {
          setParticipants(payload.data.participants);
        }
      } catch {
        // 잠깐 끊겨도 마지막 정상 상태를 유지하고 다음 주기에 다시 확인한다.
      }
    };

    void refresh();
    const interval = setInterval(refresh, 3_000);
    return () => {
      disposed = true;
      clearInterval(interval);
    };
  }, [closed, meeting.id]);

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
      setParticipants([]);
    } catch {
      setCloseError(strings.list.closeFailed);
    } finally {
      setClosing(false);
    }
  };

  const stopParticipantVoice = async (participantId: string) => {
    if (stoppingVoice) return;
    setStoppingVoice(participantId);
    setVoiceError(null);
    try {
      const response = await fetch(`/api/meetings/${meeting.id}/voice-status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId }),
      });
      if (!response.ok) throw new Error("stop failed");
      setParticipants((current) => current.map((participant) =>
        participant.participantId === participantId
          ? { ...participant, microphoneOn: false }
          : participant,
      ));
    } catch {
      setVoiceError(strings.dashboard.stopMicrophoneFailed);
    } finally {
      setStoppingVoice(null);
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
      setQr(await generateQr(url, `${key}-qr.png`));
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
  const hasInput = languageConfigs.some((row) => row.inputEnabled);

  const copyBtn =
    "min-h-9 shrink-0 cursor-pointer whitespace-nowrap border border-line px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:bg-fg hover:text-bg sm:min-h-0";
  const minutesBtn =
    "cursor-pointer border border-line px-3 py-2 font-mono text-[12px] text-muted transition-colors hover:border-fg hover:bg-fg hover:text-bg";

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
        <MinutesDownloadButtons
          meetingId={meeting.id}
          languages={languages}
          strings={strings.log}
          buttonClass={minutesBtn}
        />
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
            {strings.list.transcriptionProvider}: {meeting.transcriptionProvider === "local"
              ? strings.list.transcriptionLocal
              : meeting.transcriptionProvider === "google"
                ? strings.list.transcriptionGoogle
                : strings.list.transcriptionOpenai}
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

      <section className="mt-5 border-y border-line py-4">
        <div className="font-mono text-[11px] text-muted">
          {strings.dashboard.participantStatus}
        </div>
        <div aria-live="polite" className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {participants.length ? participants.map((participant) => (
            <div
              key={participant.participantId}
              className="grid h-[5.5rem] min-w-0 grid-rows-[minmax(0,1fr)_auto] gap-2 overflow-hidden border border-line px-3 py-2 font-mono text-[11px]"
            >
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <span
                  aria-hidden
                  className={`h-2 w-2 shrink-0 rounded-full ${participant.microphoneOn ? "bg-fg" : "border border-line"}`}
                />
                <span
                  className="min-w-0 truncate whitespace-nowrap"
                  title={participantLabel(participant)}
                >
                  {participantLabel(participant)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="shrink-0 text-muted">
                  {participant.microphoneOn
                    ? strings.dashboard.microphoneOn
                    : strings.dashboard.microphoneOff}
                </span>
                {participant.microphoneOn ? (
                  <button
                    type="button"
                    disabled={Boolean(stoppingVoice)}
                    onClick={() => void stopParticipantVoice(participant.participantId)}
                    className="max-w-[60%] shrink-0 cursor-pointer truncate whitespace-nowrap border border-line px-2 py-1 hover:border-fg disabled:cursor-default disabled:opacity-30"
                  >
                    {stoppingVoice === participant.participantId
                      ? strings.dashboard.stoppingMicrophone
                      : strings.dashboard.stopMicrophone}
                  </button>
                ) : (
                  <span
                    aria-hidden
                    className="invisible max-w-[60%] shrink-0 truncate whitespace-nowrap border px-2 py-1"
                  >
                    {strings.dashboard.stopMicrophone}
                  </span>
                )}
              </div>
            </div>
          )) : (
            <p className="font-mono text-[11px] text-muted">
              {strings.dashboard.participantNone}
            </p>
          )}
        </div>
        {voiceError ? <p className="mt-2 font-mono text-[11px]">{voiceError}</p> : null}
      </section>

      <section className="mt-7">
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
        {combined && hasOutput ? (
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
        {combined && hasInput ? (
          <div className="grid grid-cols-1 gap-3 border-b border-line py-4 lg:grid-cols-[110px_1fr] lg:items-center lg:gap-x-5 lg:py-3.5">
            <div className="text-[15px]">{strings.dashboard.inputGuide}</div>
            <UrlCell
              url={`${origin}/join/input/${combined.token}`}
              copied={copied?.key === "input-guide" ? copied : null}
              onCopy={(url) => void copy("input-guide", url)}
              className={copyBtn}
              strings={strings.dashboard}
              onQr={(url) => void showQr("input-guide", url)}
            />
          </div>
        ) : null}
      </section>

      {coverage.unsupported.length ? (
        <div className="mt-6 border border-line px-4 py-3 font-mono text-[12px] text-muted">
          {strings.dashboard.unsupportedEngine
            .replace("{engine}", coverage.label)
            .replace("{languages}", coverage.unsupported.map(nameOf).join(" · "))
            .replace(
              "{fallback}",
              fallbackCoverage?.label ?? strings.list.noFallback,
            )}
        </div>
      ) : null}

      <TranscriptionContextSettings
        meetingId={meeting.id}
        initialContext={meeting.transcriptionContext}
        strings={strings}
      />

      <QrDialog
        dialogRef={qrDialogRef}
        qr={qr}
        error={qrError}
        onClose={() => {
          setQr(null);
          setQrError(null);
        }}
        strings={strings.dashboard}
        buttonClass={copyBtn}
      />
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
