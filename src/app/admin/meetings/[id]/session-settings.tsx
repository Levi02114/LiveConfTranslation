"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";

import type { AdminStrings } from "@/lib/i18n-builtin";
import type { Language, LanguageCode } from "@/lib/languages";
import type {
  MeetingLanguageConfig,
  SessionPreset,
  SessionPresetConfig,
} from "@/lib/repo";

import { AdminBusyOverlay } from "../../admin-busy-overlay";

const MEETING_PRESET = "builtin:meeting";
const ASSEMBLY_PRESET = "builtin:assembly";

export function SessionSettings({
  meetingId,
  initialLanguages,
  initialSpeakerLabels,
  initialCombinedInputFallbackLang,
  initialPresets,
  availableLanguages,
  locked,
  strings,
}: {
  meetingId: string;
  initialLanguages: MeetingLanguageConfig[];
  initialSpeakerLabels: boolean;
  initialCombinedInputFallbackLang: LanguageCode | null;
  initialPresets: SessionPreset[];
  availableLanguages: Language[];
  locked: boolean;
  strings: AdminStrings;
}) {
  const router = useRouter();
  const [navigating, startNavigation] = useTransition();
  const [languages, setLanguages] = useState(initialLanguages);
  const [speakerLabels, setSpeakerLabels] = useState(initialSpeakerLabels);
  const [combinedInputFallbackLang, setCombinedInputFallbackLang] = useState(
    initialCombinedInputFallbackLang,
  );
  const [presets, setPresets] = useState(initialPresets);
  const [selectedPreset, setSelectedPreset] = useState(() =>
    initialCombinedInputFallbackLang === null &&
    initialLanguages.every((row) => row.inputEnabled && !row.outputEnabled) && initialSpeakerLabels
      ? MEETING_PRESET
      : initialCombinedInputFallbackLang === null &&
          initialLanguages.every((row) => row.inputEnabled && row.outputEnabled) &&
          !initialSpeakerLabels
        ? ASSEMBLY_PRESET
        : "",
  );
  const [presetName, setPresetName] = useState("");
  const [languageToAdd, setLanguageToAdd] = useState("");
  const [pending, setPending] = useState<"settings" | "preset" | "delete" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const languageByCode = useMemo(
    () => new Map(availableLanguages.map((language) => [language.code, language])),
    [availableLanguages],
  );
  const addable = availableLanguages.filter(
    (language) => !languages.some((row) => row.lang === language.code),
  );
  const selectedCustom = presets.find((preset) => preset.id === selectedPreset);
  const disabled = locked || pending !== null || navigating;

  const applyPreset = () => {
    setError(null);
    setNotice(null);
    if (selectedPreset === MEETING_PRESET) {
      setLanguages((rows) =>
        rows.map((row) => ({ ...row, inputEnabled: true, outputEnabled: false })),
      );
      setSpeakerLabels(true);
      setCombinedInputFallbackLang(null);
      setPresetName("");
      return;
    }
    if (selectedPreset === ASSEMBLY_PRESET) {
      setLanguages((rows) =>
        rows.map((row) => ({ ...row, inputEnabled: true, outputEnabled: true })),
      );
      setSpeakerLabels(false);
      setCombinedInputFallbackLang(null);
      setPresetName("");
      return;
    }
    if (selectedCustom) {
      setLanguages(selectedCustom.languages.filter((row) => languageByCode.has(row.lang)));
      setSpeakerLabels(selectedCustom.speakerLabels);
      setCombinedInputFallbackLang(selectedCustom.combinedInputFallbackLang);
      setPresetName(selectedCustom.name);
    }
  };

  const validate = (): boolean => {
    const active = languages.filter((row) => row.inputEnabled || row.outputEnabled);
    if (active.length < 2) {
      setError(strings.settings.needLanguages);
      return false;
    }
    if (!active.some((row) => row.inputEnabled)) {
      setError(strings.settings.needInput);
      return false;
    }
    return true;
  };

  const config = (): SessionPresetConfig => ({
    languages,
    speakerLabels,
    combinedInputFallbackLang,
  });

  const saveSettings = async () => {
    if (disabled || !validate()) return;
    setPending("settings");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/meetings/${meetingId}/config`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(config()),
      });
      if (!response.ok) {
        setError(response.status === 409 ? strings.settings.locked : strings.settings.saveFailed);
        return;
      }
      setNotice(strings.settings.saved);
      startNavigation(() => router.refresh());
    } catch {
      setError(strings.settings.saveFailed);
    } finally {
      setPending(null);
    }
  };

  const savePreset = async () => {
    if (disabled || !presetName.trim() || !validate()) return;
    setPending("preset");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/admin/session-presets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: selectedCustom?.id,
          name: presetName.trim(),
          config: config(),
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { preset?: SessionPreset }
        | null;
      if (!response.ok || !payload?.preset) {
        setError(strings.settings.presetFailed);
        return;
      }
      const saved = payload.preset;
      setPresets((rows) => [saved, ...rows.filter((row) => row.id !== saved.id)]);
      setSelectedPreset(saved.id);
      setNotice(strings.settings.presetSaved);
    } catch {
      setError(strings.settings.presetFailed);
    } finally {
      setPending(null);
    }
  };

  const removePreset = async () => {
    if (disabled || !selectedCustom || !window.confirm(strings.settings.deletePresetConfirm)) return;
    setPending("delete");
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(
        `/api/admin/session-presets?id=${encodeURIComponent(selectedCustom.id)}`,
        { method: "DELETE" },
      );
      if (!response.ok) {
        setError(strings.settings.presetFailed);
        return;
      }
      setPresets((rows) => rows.filter((row) => row.id !== selectedCustom.id));
      setSelectedPreset("");
      setPresetName("");
    } catch {
      setError(strings.settings.presetFailed);
    } finally {
      setPending(null);
    }
  };

  const toggle = (
    code: LanguageCode,
    field: "inputEnabled" | "outputEnabled",
  ) => {
    setLanguages((rows) => {
      const next = rows.map((row) =>
        row.lang === code ? { ...row, [field]: !row[field] } : row,
      );
      if (
        field === "inputEnabled" &&
        combinedInputFallbackLang === code &&
        !next.find((row) => row.lang === code)?.inputEnabled
      ) {
        setCombinedInputFallbackLang(null);
      }
      return next;
    });
  };

  return (
    <section className="mt-9 border-y border-line py-5">
      <AdminBusyOverlay
        label={pending || navigating ? strings.list.loading : null}
      />
      <div className="mb-4 font-mono text-[11px] text-muted">{strings.settings.heading}</div>

      {locked ? (
        <div className="border border-line px-3 py-2.5 font-mono text-[12px] text-muted">
          {strings.settings.locked}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-end gap-2.5">
        <label className="min-w-[180px] flex-1 font-mono text-[11px] text-muted sm:max-w-[320px]">
          <span className="mb-1.5 block">{strings.settings.preset}</span>
          <select
            value={selectedPreset}
            onChange={(event) => {
              const value = event.target.value;
              setSelectedPreset(value);
              setPresetName(presets.find((preset) => preset.id === value)?.name ?? "");
            }}
            disabled={disabled}
            className="h-10 w-full border border-line bg-bg px-2.5 text-fg outline-none disabled:opacity-50"
          >
            <option value="">—</option>
            <option value={MEETING_PRESET}>{strings.settings.meetingPreset}</option>
            <option value={ASSEMBLY_PRESET}>{strings.settings.assemblyPreset}</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.name}</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={applyPreset}
          disabled={disabled || !selectedPreset}
          className="min-h-10 cursor-pointer border border-line px-4 font-mono text-[12px] hover:border-fg disabled:cursor-default disabled:opacity-30"
        >
          {strings.settings.applyPreset}
        </button>
      </div>

      <div className="mt-6">
        <div className="mb-2 font-mono text-[11px] text-muted">{strings.settings.languages}</div>
        <div className="border-t border-line">
          {languages.map((row) => (
            <div
              key={row.lang}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] items-center gap-2 border-b border-line py-3 sm:gap-3"
            >
              <span className="min-w-0 break-words text-[14px]">
                {languageByCode.get(row.lang)?.label ?? row.lang}
              </span>
              <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap font-mono text-[11px] sm:gap-2">
                <input
                  type="checkbox"
                  checked={row.inputEnabled}
                  onChange={() => toggle(row.lang, "inputEnabled")}
                  disabled={disabled}
                  className="h-[15px] w-[15px] accent-[var(--fg)]"
                />
                {strings.settings.input}
              </label>
              <label className="flex cursor-pointer items-center gap-1.5 whitespace-nowrap font-mono text-[11px] sm:gap-2">
                <input
                  type="checkbox"
                  checked={row.outputEnabled}
                  onChange={() => toggle(row.lang, "outputEnabled")}
                  disabled={disabled}
                  className="h-[15px] w-[15px] accent-[var(--fg)]"
                />
                {strings.settings.output}
              </label>
              <button
                type="button"
                onClick={() => {
                  setLanguages((rows) => rows.filter((item) => item.lang !== row.lang));
                  if (combinedInputFallbackLang === row.lang) setCombinedInputFallbackLang(null);
                }}
                disabled={disabled}
                title={strings.languages.remove}
                aria-label={`${strings.languages.remove}: ${languageByCode.get(row.lang)?.label ?? row.lang}`}
                className="cursor-pointer px-1 font-mono text-[16px] text-muted hover:text-fg disabled:cursor-default disabled:opacity-30 sm:px-2"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {addable.length ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <select
              value={languageToAdd}
              onChange={(event) => setLanguageToAdd(event.target.value)}
              disabled={disabled}
              aria-label={strings.settings.selectLanguage}
              className="h-9 min-w-[170px] border border-line bg-bg px-2 font-mono text-[12px] text-fg outline-none disabled:opacity-50"
            >
              <option value="">{strings.settings.selectLanguage}</option>
              {addable.map((language) => (
                <option key={language.code} value={language.code}>{language.label}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={disabled || !languageToAdd}
              onClick={() => {
                setLanguages((rows) => [
                  ...rows,
                  {
                    lang: languageToAdd as LanguageCode,
                    inputEnabled: true,
                    outputEnabled: false,
                  },
                ]);
                setLanguageToAdd("");
              }}
              className="min-h-9 cursor-pointer border border-line px-3 font-mono text-[11px] hover:border-fg disabled:cursor-default disabled:opacity-30"
            >
              {strings.settings.addLanguage}
            </button>
          </div>
        ) : null}
      </div>

      <label className="mt-5 flex items-start gap-2.5 font-mono text-[11px]">
        <input
          type="checkbox"
          checked={speakerLabels}
          onChange={(event) => setSpeakerLabels(event.target.checked)}
          disabled={disabled}
          className="mt-0.5 h-[15px] w-[15px] accent-[var(--fg)]"
        />
        <span>
          <span className="block text-fg">{strings.settings.nickname}</span>
          <span className="mt-1 block leading-5 text-muted">{strings.settings.nicknameNote}</span>
        </span>
      </label>

      <div className="mt-5 border-t border-line pt-5">
        <label className="flex items-start gap-2.5 font-mono text-[11px]">
          <input
            type="checkbox"
            checked={combinedInputFallbackLang !== null}
            onChange={(event) =>
              setCombinedInputFallbackLang(
                event.target.checked
                  ? (languages.find((row) => row.inputEnabled)?.lang ?? null)
                  : null,
              )
            }
            disabled={disabled}
            className="mt-0.5 h-[15px] w-[15px] accent-[var(--fg)]"
          />
          <span>
            <span className="block text-fg">{strings.settings.combinedInput}</span>
            <span className="mt-1 block leading-5 text-muted">
              {strings.settings.combinedInputNote}
            </span>
          </span>
        </label>
        {combinedInputFallbackLang !== null ? (
          <label className="mt-3 block max-w-[320px] font-mono text-[11px] text-muted">
            <span className="mb-1.5 block">{strings.settings.combinedInputFallback}</span>
            <select
              value={combinedInputFallbackLang}
              onChange={(event) => setCombinedInputFallbackLang(event.target.value)}
              disabled={disabled}
              className="h-10 w-full border border-line bg-bg px-2.5 text-fg outline-none disabled:opacity-50"
            >
              {languages.filter((row) => row.inputEnabled).map((row) => (
                <option key={row.lang} value={row.lang}>
                  {languageByCode.get(row.lang)?.label ?? row.lang}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-2.5">
        <button
          type="button"
          onClick={() => void saveSettings()}
          disabled={disabled}
          className="min-h-10 cursor-pointer border border-fg px-4 font-mono text-[12px] hover:bg-fg hover:text-bg disabled:cursor-default disabled:opacity-30"
        >
          {pending === "settings" ? strings.settings.saving : strings.settings.save}
        </button>
        <label className="min-w-[180px] flex-1 font-mono text-[11px] text-muted sm:max-w-[260px]">
          <span className="mb-1.5 block">{strings.settings.presetName}</span>
          <input
            value={presetName}
            maxLength={80}
            onChange={(event) => setPresetName(event.target.value)}
            disabled={disabled}
            className="h-10 w-full border border-line bg-bg px-2.5 text-fg outline-none disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          onClick={() => void savePreset()}
          disabled={disabled || !presetName.trim()}
          className="min-h-10 cursor-pointer border border-line px-4 font-mono text-[11px] hover:border-fg disabled:cursor-default disabled:opacity-30"
        >
          {selectedCustom ? strings.settings.updatePreset : strings.settings.savePreset}
        </button>
        {selectedCustom ? (
          <button
            type="button"
            onClick={() => void removePreset()}
            disabled={disabled}
            className="min-h-10 cursor-pointer border border-line px-4 font-mono text-[11px] text-muted hover:border-fg hover:text-fg disabled:cursor-default disabled:opacity-30"
          >
            {strings.settings.deletePreset}
          </button>
        ) : null}
      </div>

      {notice ? <p className="mt-3 font-mono text-[11px] text-muted">{notice}</p> : null}
      {error ? <p className="mt-3 font-mono text-[11px] text-fg">{error}</p> : null}
    </section>
  );
}
