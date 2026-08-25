"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { z } from "zod";

import { AppearanceControls } from "@/components/appearance-controls";
import { generateQr, QrDialog, type QrImage } from "@/components/qr-dialog";
import { useSetAdminLang } from "@/hooks/use-admin-lang";
import { usePublicOrigin } from "@/hooks/use-public-origin";
import type { AdminStrings, UiStrings } from "@/lib/i18n-builtin";
import type { Language, LanguageCode } from "@/lib/languages";
import { formatTimestamp } from "@/lib/log-format";
import { parseJsonResponse } from "@/lib/json-response";
import type { Meeting, SessionPreset, SessionPresetConfig, TranscriptionProvider } from "@/lib/repo";
import { engineIdSchema, isEngineId, type EngineId } from "@/lib/translate/types";
import { transcriptionProviderSchema } from "@/lib/repo-schema";

import { AdminBusyOverlay } from "./admin-busy-overlay";
import { EngineKeysDialog, type EngineKeyStatus } from "./engine-keys-dialog";
import { GlossaryDialog } from "./glossary-dialog";
import { LanguageDialog } from "./language-dialog";
import { OpenaiModelSelect } from "./openai-model-select";
import { OpenaiUsageDialog } from "./openai-usage-dialog";
import { PasswordChangeDialog } from "./password-change-dialog";
import { UiStringsDialog } from "./ui-strings-dialog";
import { SessionConfigEditor } from "./meetings/[id]/session-settings";

type Row = Meeting & { langs: LanguageCode[] };
const meetingResponseSchema = z.object({
  meeting: z.object({
    id: z.string(),
    title: z.string(),
    status: z.enum(["open", "closed"]),
    engine: engineIdSchema,
    fallbackEngine: engineIdSchema.nullable(),
    inputMode: z.enum(["human", "realtime"]),
    speakerLabels: z.boolean(),
    transcriptionContext: z.string().nullable(),
    translationModel: z.string().nullable(),
    transcriptionProvider: z.enum(["openai", "local"]),
    createdAt: z.number(),
    closedAt: z.number().nullable(),
  }).optional(),
  error: z.string().optional(),
});

export function MeetingList({
  lang,
  strings,
  ui,
  meetings,
  languages,
  defaultLangs,
  engines: initialEngines,
  engineKeys,
  defaultEngine,
  openaiModel,
  presets,
  localTranscriptionAvailable,
  defaultTranscriptionProvider,
}: {
  lang: LanguageCode;
  strings: AdminStrings;
  ui: UiStrings;
  meetings: Row[];
  /** 등록된 언어. `builtin`/`used` 는 제거 버튼을 그릴지 정하는 데 쓴다. */
  languages: (Language & { builtin: boolean; used: boolean })[];
  defaultLangs: LanguageCode[];
  engines: { id: EngineId; label: string; configured: boolean }[];
  engineKeys: EngineKeyStatus[];
  defaultEngine: EngineId;
  /** OpenAI 번역에 쓰는 고정 언어모델. */
  openaiModel: string;
  presets: SessionPreset[];
  localTranscriptionAvailable: boolean;
  defaultTranscriptionProvider: TranscriptionProvider;
}) {
  const router = useRouter();
  const setLang = useSetAdminLang();
  const [navigating, startNavigation] = useTransition();
  const origin = usePublicOrigin();
  const qrDialogRef = useRef<HTMLDialogElement>(null);
  const [qr, setQr] = useState<QrImage | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [config, setConfig] = useState<SessionPresetConfig>(() => ({
    languages: defaultLangs.map((code) => ({
      lang: code,
      inputEnabled: true,
      outputEnabled: false,
    })),
    speakerLabels: true,
    combinedInputFallbackLang: null,
  }));
  const [engine, setEngine] = useState<EngineId>(defaultEngine);
  const [fallbackEngine, setFallbackEngine] = useState<EngineId | null>(null);
  const [transcriptionProvider, setTranscriptionProvider] = useState(defaultTranscriptionProvider);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [closing, setClosing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [meetingRows, setMeetingRows] = useState(meetings);
  // 키를 등록하면 "(키 없음)" 표시가 즉시 사라져야 한다.
  const [engines, setEngines] = useState(initialEngines);
  const engineKeysDialog = (
    <EngineKeysDialog
      strings={strings.keys}
      engines={engines.filter((item) => item.id !== "local").map((item) => ({ id: item.id, label: item.label }))}
      initial={engineKeys}
      onChange={(status) =>
        setEngines((prev) =>
          prev.map((item) =>
            item.id === status.engine ? { ...item, configured: status.configured } : item,
          ),
        )
      }
    />
  );

  // Next 16은 뒤로가기 때 이전 RSC 화면을 복원한다. 다시 보일 때 DB 목록을 합친다.
  useEffect(() => router.refresh(), [router]);

  /*
   * 지울 수 있는 언어.
   *
   * 기본 네 언어는 코드에 검수된 문구가 있어 못 지우고, 회의에서 쓰인 언어를
   * 지우면 그 회의의 페이지·번역·로그가 이름 없는 코드만 남는다. 서버가 어차피
   * 거부하지만(409), 누를 수 없는 버튼을 안 그리는 편이 낫다.
   */
  const removable = new Set(
    languages.filter((item) => !item.builtin && !item.used).map((item) => item.code),
  );

  const removeLanguage = async (code: LanguageCode) => {
    if (actionPending) return;
    setActionPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/languages?code=${encodeURIComponent(code)}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        setError(strings.languages.removeFailed);
        return;
      }
      setConfig((current) => ({
        ...current,
        languages: current.languages.filter((row) => row.lang !== code),
        combinedInputFallbackLang:
          current.combinedInputFallbackLang === code ? null : current.combinedInputFallbackLang,
      }));
      startNavigation(() => router.refresh());
    } catch {
      setError(strings.languages.removeFailed);
    } finally {
      setActionPending(false);
    }
  };

  const toggle = (code: LanguageCode) => {
    setConfig((current) => {
      const exists = current.languages.some((row) => row.lang === code);
      return {
        ...current,
        languages: exists
          ? current.languages.filter((row) => row.lang !== code)
          : [...current.languages, { lang: code, inputEnabled: true, outputEnabled: false }],
        combinedInputFallbackLang:
          exists && current.combinedInputFallbackLang === code
            ? null
            : current.combinedInputFallbackLang,
      };
    });
  };

  const selectEngine = async (next: EngineId) => {
    if (actionPending) return;
    setEngine(next);
    setFallbackEngine((current) => (current === next ? null : current));
    setActionPending(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/engine-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ engine: next }),
      });
      if (!response.ok) setError(strings.list.settingFailed);
    } catch {
      setError(strings.list.settingFailed);
    } finally {
      setActionPending(false);
    }
  };

  const selectTranscriptionProvider = async (next: TranscriptionProvider) => {
    if (actionPending) return;
    setTranscriptionProvider(next);
    setActionPending(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/engine-settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ transcriptionProvider: next }),
      });
      if (!response.ok) setError(strings.list.settingFailed);
    } catch {
      setError(strings.list.settingFailed);
    } finally {
      setActionPending(false);
    }
  };

  const create = async () => {
    if (pending) return;
    if (!title.trim()) {
      setError(strings.list.needTitle);
      return;
    }
    const active = config.languages.filter((row) => row.inputEnabled || row.outputEnabled);
    if (active.length < 2) {
      setError(strings.list.needLanguages);
      return;
    }
    if (!active.some((row) => row.inputEnabled)) {
      setError(strings.settings.needInput);
      return;
    }
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/meetings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          config,
          engine,
          fallbackEngine,
          transcriptionProvider,
        }),
      });
      const payload = await parseJsonResponse(response, meetingResponseSchema);

      if (!response.ok || !payload?.meeting) {
        setError(strings.list.createFailed);
        return;
      }
      const created = payload.meeting;
      startNavigation(() => router.push(`/admin/meetings/${created.id}`));
    } catch {
      setError(strings.list.createFailed);
    } finally {
      setPending(false);
    }
  };

  const logout = async () => {
    if (actionPending) return;
    setActionPending(true);
    // 라우트 핸들러가 JSON 을 돌려주므로 폼 전송이 아니라 fetch 로 부른다.
    try {
      await fetch("/api/admin/logout", { method: "POST" });
      startNavigation(() => {
        router.refresh();
        router.replace("/admin/login");
      });
    } finally {
      setActionPending(false);
    }
  };

  const showAdminQr = async () => {
    setQr(null);
    setQrError(null);
    qrDialogRef.current?.showModal();
    try {
      setQr(await generateQr(`${origin.replace(/\/$/, "")}/admin`, "admin-qr.png"));
    } catch {
      setQrError(strings.dashboard.qrFailed);
    }
  };

  const removeMeeting = async (meeting: Row) => {
    const prompt = strings.list.deleteConfirm.replace("{title}", meeting.title);
    if (!window.confirm(prompt)) return;

    setDeleting(meeting.id);
    setError(null);
    try {
      const response = await fetch(`/api/meetings/${meeting.id}`, { method: "DELETE" });
      if (!response.ok) {
        setError(strings.list.deleteFailed);
        return;
      }
      setMeetingRows((prev) => prev.filter((row) => row.id !== meeting.id));
      startNavigation(() => router.refresh());
    } catch {
      setError(strings.list.deleteFailed);
    } finally {
      setDeleting(null);
    }
  };

  const closeMeeting = async (meeting: Row) => {
    const prompt = strings.list.closeConfirm.replace("{title}", meeting.title);
    if (!window.confirm(prompt)) return;

    setClosing(meeting.id);
    setError(null);
    try {
      const response = await fetch(`/api/meetings/${meeting.id}`, { method: "POST" });
      const payload = await parseJsonResponse(response, meetingResponseSchema);
      if (!response.ok || !payload?.meeting) {
        setError(strings.list.closeFailed);
        return;
      }
      setMeetingRows((prev) =>
        prev.map((row) =>
          row.id === meeting.id ? { ...row, ...payload.meeting } : row,
        ),
      );
      startNavigation(() => router.refresh());
    } catch {
      setError(strings.list.closeFailed);
    } finally {
      setClosing(null);
    }
  };

  const open = meetingRows.filter((meeting) => meeting.status === "open");
  const closed = meetingRows.filter((meeting) => meeting.status === "closed");
  const busyLabel = pending
    ? strings.list.creating
    : closing
      ? strings.list.closingSession
      : deleting
        ? strings.list.deletingSession
        : actionPending || navigating
          ? strings.list.loading
          : null;

  /*
   * 언어 이름은 그 언어 표기(`nativeName`)로 쓴다. 관리자 화면이 네 언어로 뜨는데
   * 언어 목록만 한국어면 읽을 수 없고, 언어 이름 16벌을 따로 번역할 이유도 없다.
   */
  const nameList = (codes: LanguageCode[]) =>
    codes
      .map((code) => languages.find((language) => language.code === code)?.nativeName ?? code)
      .join(" · ");
  const langs = config.languages.map((row) => row.lang);

  return (
    <div className="mx-auto max-w-[840px] px-4 pt-20 pb-12 sm:px-8 sm:pb-16">
      <AdminBusyOverlay label={busyLabel} />
      <AppearanceControls
        strings={ui.appearance}
        qr={{ label: strings.dashboard.showQr, onClick: () => void showAdminQr() }}
        language={{
          value: lang,
          label: strings.language.label,
          options: languages,
          onChange: (next) => startNavigation(() => setLang(next)),
        }}
      />

      <div className="flex items-baseline justify-between gap-4">
        <div className="font-mono text-[12px] tracking-[0.04em] text-muted">
          {strings.list.heading}
        </div>
        <div className="flex items-center gap-3">
          <PasswordChangeDialog strings={strings.passwordChange} />
          <button
            type="button"
            onClick={() => void logout()}
            className="cursor-pointer font-mono text-[11px] text-muted hover:text-fg"
          >
            {strings.list.logout}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-6 border-b border-line pt-6 pb-9">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={strings.list.titlePlaceholder}
          className="app-text border-0 border-b border-line bg-transparent py-1.5 outline-none focus:border-fg"
        />

        <div>
          <div className="mb-2.5 flex items-center gap-2 font-mono text-[11px] text-muted">
            <span>{strings.list.languages}</span>
            <LanguageDialog
              strings={strings.languages}
              display={lang}
              engines={engines}
              defaultEngine={engine}
              onAdded={() => startNavigation(() => router.refresh())}
            />
            <UiStringsDialog
              strings={strings.strings}
              languages={languages}
              initialLang={lang}
              engines={engines}
              defaultEngine={engine}
              onSaved={() => startNavigation(() => router.refresh())}
            />
            <GlossaryDialog
              strings={strings.glossary}
              languages={languages}
              displayLang={lang}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            {languages.map((language) => {
              const on = langs.includes(language.code);
              return (
                <span
                  key={language.code}
                  className={`flex items-center border font-mono text-[13px] transition-colors ${
                    on ? "border-fg bg-fg text-bg" : "border-line text-muted"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => toggle(language.code)}
                    className="cursor-pointer px-3 py-1.5 hover:opacity-70"
                  >
                    {language.nativeName}
                  </button>
                  {/* 기본 네 언어와 회의에서 쓰인 언어는 지울 수 없다 — 서버도 거부한다. */}
                  {removable.has(language.code) ? (
                    <button
                      type="button"
                      onClick={() => void removeLanguage(language.code)}
                      title={strings.languages.remove}
                      aria-label={`${strings.languages.remove}: ${language.nativeName}`}
                      className="cursor-pointer py-1.5 pr-2.5 pl-1 opacity-50 hover:opacity-100"
                    >
                      ×
                    </button>
                  ) : null}
                </span>
              );
            })}
          </div>
        </div>

        <SessionConfigEditor
          value={config}
          onChange={setConfig}
          initialPresets={presets}
          availableLanguages={languages}
          strings={strings}
          disabled={pending}
        />

        <div className="flex flex-wrap items-center gap-3.5">
          <div className="font-mono text-[11px] text-muted">{strings.list.engine}</div>
          <EngineSelect
            value={engine}
            engines={engines}
            noKeyLabel={strings.list.engineNoKey}
            notInstalledLabel={strings.list.notInstalled}
            onChange={(next) => next && void selectEngine(next)}
          />
          <OpenaiModelSelect
            label={strings.list.model}
            model={openaiModel}
            hidden={engine !== "openai"}
          />

          {engine !== "local" ? engineKeysDialog : null}
          {engine === "openai" ? <OpenaiUsageDialog strings={strings.openaiUsage} /> : null}
        </div>

        {engine === "local" ? (
          <p className="font-mono text-[11px] leading-5 text-muted">{strings.list.localGlossaryUnsupported}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-3.5">
          <label htmlFor="transcription-provider" className="font-mono text-[11px] text-muted">
            {strings.list.transcriptionProvider}
          </label>
          <select
            id="transcription-provider"
            value={transcriptionProvider}
            onChange={(event) => {
              const parsed = transcriptionProviderSchema.safeParse(event.target.value);
              if (parsed.success) void selectTranscriptionProvider(parsed.data);
            }}
            className="max-w-full border border-line bg-bg px-2.5 py-1.5 font-mono text-[13px] outline-none"
          >
            <option value="openai">{strings.list.transcriptionOpenai}</option>
            <option value="local" disabled={!localTranscriptionAvailable}>
              {strings.list.transcriptionLocal}{localTranscriptionAvailable ? "" : ` · ${strings.list.notInstalled}`}
            </option>
          </select>
        </div>

        <div className="flex flex-wrap items-center gap-3.5">
          <div className="font-mono text-[11px] text-muted">
            {strings.list.fallbackEngine}
          </div>
          <EngineSelect
            value={fallbackEngine}
            engines={engines}
            noKeyLabel={strings.list.engineNoKey}
            notInstalledLabel={strings.list.notInstalled}
            noneLabel={strings.list.noFallback}
            exclude={engine}
            onChange={setFallbackEngine}
          />
          <OpenaiModelSelect
            label={strings.list.model}
            model={openaiModel}
            hidden={fallbackEngine !== "openai"}
          />
        </div>

        {error ? <div className="font-mono text-[12px]">{error}</div> : null}

        <div>
          <button
            type="button"
            onClick={() => void create()}
            disabled={pending}
            className="cursor-pointer border border-fg px-6 py-2.5 font-mono text-[14px] transition-colors hover:bg-fg hover:text-bg disabled:cursor-default disabled:opacity-30"
          >
            {pending ? strings.list.creating : strings.list.create}
          </button>
        </div>
      </div>

      <Section title={strings.list.active} empty={strings.list.noActive} count={open.length}>
        {open.map((meeting) => (
          <div
            key={meeting.id}
            className="flex w-full flex-col gap-3 border-t border-line py-4 sm:flex-row sm:items-center sm:gap-4"
          >
            <button
              type="button"
              onClick={() =>
                startNavigation(() => router.push(`/admin/meetings/${meeting.id}`))
              }
              className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-1.5 text-left hover:opacity-60 xl:flex-row xl:items-baseline xl:justify-between xl:gap-4"
            >
              <span className="app-text min-w-0 break-words">{meeting.title}</span>
              <span className="font-mono text-[11px] leading-5 text-muted sm:text-[12px] xl:shrink-0 xl:whitespace-nowrap">
                {nameList(meeting.langs)} · {formatTimestamp(meeting.createdAt)} ·{" "}
                {strings.list.active} →
              </span>
            </button>
            <button
              type="button"
              onClick={() => void closeMeeting(meeting)}
              disabled={closing !== null}
              className="min-h-9 cursor-pointer self-start border border-line px-3 py-1 font-mono text-[11px] text-muted hover:border-fg hover:text-fg disabled:cursor-default disabled:opacity-30 sm:min-h-0 sm:self-auto sm:px-2.5"
            >
              {closing === meeting.id
                ? strings.list.closingSession
                : strings.list.closeSession}
            </button>
          </div>
        ))}
      </Section>

      <Section title={strings.list.closed} empty={strings.list.noClosed} count={closed.length}>
        {closed.map((meeting) => (
          <div
            key={meeting.id}
            className="flex w-full flex-col gap-3 border-t border-line py-4 text-muted sm:flex-row sm:items-center sm:gap-4"
          >
            <button
              type="button"
              onClick={() =>
                startNavigation(() => router.push(`/admin/meetings/${meeting.id}`))
              }
              className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-1.5 text-left hover:opacity-60 xl:flex-row xl:items-baseline xl:justify-between xl:gap-4"
            >
              <span className="app-text min-w-0 break-words">{meeting.title}</span>
              <span className="font-mono text-[11px] leading-5 sm:text-[12px] xl:shrink-0 xl:whitespace-nowrap">
                {nameList(meeting.langs)} · {formatTimestamp(meeting.createdAt)}
              </span>
            </button>
            <button
              type="button"
              onClick={() => void removeMeeting(meeting)}
              disabled={deleting !== null}
              className="min-h-9 cursor-pointer self-start border border-line px-3 py-1 font-mono text-[11px] hover:border-fg hover:text-fg disabled:cursor-default disabled:opacity-30 sm:min-h-0 sm:self-auto sm:px-2.5"
            >
              {deleting === meeting.id
                ? strings.list.deletingSession
                : strings.list.deleteSession}
            </button>
          </div>
        ))}
      </Section>

      <QrDialog
        dialogRef={qrDialogRef}
        qr={qr}
        error={qrError}
        onClose={() => {
          setQr(null);
          setQrError(null);
        }}
        strings={strings.dashboard}
        buttonClass="cursor-pointer border border-line px-3 py-2 font-mono text-[12px] hover:border-fg"
      />
    </div>
  );
}

function EngineSelect({
  value,
  engines,
  noKeyLabel,
  notInstalledLabel,
  noneLabel,
  exclude,
  onChange,
}: {
  value: EngineId | null;
  engines: { id: EngineId; label: string; configured: boolean }[];
  noKeyLabel: string;
  notInstalledLabel: string;
  noneLabel?: string;
  exclude?: EngineId;
  onChange: (value: EngineId | null) => void;
}) {
  return (
    <select
      value={value ?? ""}
      onChange={(event) => {
        const next = event.target.value;
        onChange(isEngineId(next) ? next : null);
      }}
      className="max-w-full border border-line bg-bg px-2.5 py-1.5 font-mono text-[13px] outline-none"
    >
      {noneLabel ? <option value="">{noneLabel}</option> : null}
      {engines
        .filter((item) => item.id !== exclude)
        .map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
            {item.configured ? "" : ` (${item.id === "local" ? notInstalledLabel : noKeyLabel})`}
          </option>
        ))}
    </select>
  );
}

function Section({
  title,
  empty,
  count,
  children,
}: {
  title: string;
  empty: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="pt-8">
      <div className="mb-1.5 font-mono text-[11px] text-muted">{title}</div>
      {count === 0 ? <p className="py-4 font-mono text-[12px] text-muted">{empty}</p> : children}
    </div>
  );
}
