"use client";

import { useMemo, useState } from "react";
import { z } from "zod";

import type { AdminStrings } from "@/lib/i18n-builtin";
import type { Language } from "@/lib/languages";
import { parseJsonResponse } from "@/lib/json-response";
import type { SessionPreset, SessionPresetConfig } from "@/lib/repo";

const sessionPresetResponseSchema = z.object({
  preset: z.object({
    id: z.string(),
    name: z.string(),
    languages: z.array(z.object({
      lang: z.string(),
      inputEnabled: z.boolean(),
      outputEnabled: z.boolean(),
    })),
    speakerLabels: z.boolean(),
    combinedInputFallbackLang: z.string().nullable(),
    createdAt: z.number(),
    updatedAt: z.number(),
  }).optional(),
});

const MEETING_PRESET = "builtin:meeting";
const ASSEMBLY_PRESET = "builtin:assembly";

function sameLanguages(config: SessionPresetConfig, preset: SessionPreset): boolean {
  if (config.languages.length !== preset.languages.length) return false;
  const selected = new Set(config.languages.map((row) => row.lang));
  return preset.languages.every((row) => selected.has(row.lang));
}

export function SessionConfigEditor({
  value,
  onChange,
  initialPresets,
  availableLanguages,
  strings,
  disabled = false,
}: {
  value: SessionPresetConfig;
  onChange: (value: SessionPresetConfig) => void;
  initialPresets: SessionPreset[];
  availableLanguages: Language[];
  strings: AdminStrings;
  disabled?: boolean;
}) {
  const [presets, setPresets] = useState(initialPresets);
  const [selectedPreset, setSelectedPreset] = useState("");
  const [presetName, setPresetName] = useState("");
  const [pending, setPending] = useState<"preset" | "delete" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const languageByCode = useMemo(
    () => new Map(availableLanguages.map((language) => [language.code, language])),
    [availableLanguages],
  );
  const selectedCustom = presets.find(
    (preset) => preset.id === selectedPreset && sameLanguages(value, preset),
  );
  const busy = disabled || pending !== null;

  const validate = (): boolean => {
    const active = value.languages.filter((row) => row.inputEnabled || row.outputEnabled);
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

  const choosePreset = (id: string) => {
    setSelectedPreset(id);
    setPresetName(presets.find((preset) => preset.id === id)?.name ?? "");
    setNotice(null);
    setError(null);
  };

  const applyPreset = () => {
    setError(null);
    setNotice(null);
    if (selectedPreset === MEETING_PRESET) {
      onChange({
        languages: value.languages.map((row) => ({ ...row, inputEnabled: true, outputEnabled: false })),
        speakerLabels: true,
        combinedInputFallbackLang: null,
      });
      setPresetName("");
      return;
    }
    if (selectedPreset === ASSEMBLY_PRESET) {
      onChange({
        languages: value.languages.map((row) => ({ ...row, inputEnabled: true, outputEnabled: true })),
        speakerLabels: false,
        combinedInputFallbackLang: null,
      });
      setPresetName("");
      return;
    }
    if (!selectedCustom || !sameLanguages(value, selectedCustom)) return;
    const settings = new Map(selectedCustom.languages.map((row) => [row.lang, row]));
    onChange({
      languages: value.languages.map((row) => settings.get(row.lang) ?? row),
      speakerLabels: selectedCustom.speakerLabels,
      combinedInputFallbackLang: selectedCustom.combinedInputFallbackLang,
    });
    setPresetName(selectedCustom.name);
  };

  const savePreset = async () => {
    if (busy || !presetName.trim() || !validate()) return;
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
          config: value,
        }),
      });
      const payload = await parseJsonResponse(response, sessionPresetResponseSchema);
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
    if (busy || !selectedCustom || !window.confirm(strings.settings.deletePresetConfirm)) return;
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

  return (
    <section className="border-y border-line py-5">
      <div className="mb-4 font-mono text-[11px] text-muted">{strings.settings.heading}</div>

      <div data-guide="session-settings" className="flex flex-wrap items-end gap-2.5">
        <label className="min-w-[180px] flex-1 font-mono text-[11px] text-muted sm:max-w-[320px]">
          <span className="mb-1.5 block">{strings.settings.preset}</span>
          <select
            value={selectedPreset}
            disabled={busy}
            onChange={(event) => choosePreset(event.target.value)}
            className="h-10 w-full cursor-pointer border border-line bg-bg px-2.5 text-fg disabled:cursor-default disabled:opacity-30"
          >
            <option value="">—</option>
            <option value={MEETING_PRESET}>{strings.settings.meetingPreset}</option>
            <option value={ASSEMBLY_PRESET}>{strings.settings.assemblyPreset}</option>
            {presets.map((preset) => {
              const compatible = sameLanguages(value, preset);
              return (
                <option
                  key={preset.id}
                  value={preset.id}
                  disabled={!compatible}
                  title={compatible ? preset.name : strings.settings.presetLanguageMismatch}
                >
                  {preset.name}{compatible ? "" : ` — ${strings.settings.presetLanguageMismatch}`}
                </option>
              );
            })}
          </select>
        </label>
        <button
          type="button"
          onClick={applyPreset}
          disabled={busy || !selectedPreset}
          className="min-h-10 cursor-pointer border border-line px-4 font-mono text-[12px] hover:border-fg disabled:cursor-default disabled:opacity-30"
        >
          {strings.settings.applyPreset}
        </button>
      </div>

      <div className="mt-6">
        <div className="mb-2 font-mono text-[11px] text-muted">{strings.settings.languages}</div>
        <div className="border-t border-line">
          {value.languages.map((row) => (
            <div key={row.lang} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-b border-line py-3">
              <span className="min-w-0 break-words text-[14px]">{languageByCode.get(row.lang)?.label ?? row.lang}</span>
              {(["inputEnabled", "outputEnabled"] as const).map((field) => (
                <label key={field} className="flex cursor-pointer items-center gap-2 whitespace-nowrap font-mono text-[11px]">
                  <input
                    type="checkbox"
                    checked={row[field]}
                    disabled={busy}
                    onChange={() => {
                      const languages = value.languages.map((item) => item.lang === row.lang
                        ? { ...item, [field]: !item[field] }
                        : item);
                      onChange({
                        ...value,
                        languages,
                        combinedInputFallbackLang:
                          field === "inputEnabled" && value.combinedInputFallbackLang === row.lang && !languages.find((item) => item.lang === row.lang)?.inputEnabled
                            ? null
                            : value.combinedInputFallbackLang,
                      });
                    }}
                    className="h-[15px] w-[15px] accent-[var(--fg)]"
                  />
                  {field === "inputEnabled" ? strings.settings.input : strings.settings.output}
                </label>
              ))}
            </div>
          ))}
        </div>
      </div>

      <label className="mt-5 flex items-start gap-2.5 font-mono text-[11px]">
        <input
          type="checkbox"
          checked={value.speakerLabels}
          disabled={busy}
          onChange={(event) => onChange({ ...value, speakerLabels: event.target.checked })}
          className="mt-0.5 h-[15px] w-[15px] accent-[var(--fg)]"
        />
        <span><span className="block text-fg">{strings.settings.nickname}</span><span className="mt-1 block leading-5 text-muted">{strings.settings.nicknameNote}</span></span>
      </label>

      <div className="mt-5 border-t border-line pt-5">
        <label className="flex items-start gap-2.5 font-mono text-[11px]">
          <input
            type="checkbox"
            checked={value.combinedInputFallbackLang !== null}
            disabled={busy}
            onChange={(event) => onChange({
              ...value,
              combinedInputFallbackLang: event.target.checked
                ? value.languages.find((row) => row.inputEnabled)?.lang ?? null
                : null,
            })}
            className="mt-0.5 h-[15px] w-[15px] accent-[var(--fg)]"
          />
          <span><span className="block text-fg">{strings.settings.combinedInput}</span><span className="mt-1 block leading-5 text-muted">{strings.settings.combinedInputNote}</span></span>
        </label>
        {value.combinedInputFallbackLang !== null ? (
          <label className="mt-3 block max-w-[320px] font-mono text-[11px] text-muted">
            <span className="mb-1.5 block">{strings.settings.combinedInputFallback}</span>
            <select
              value={value.combinedInputFallbackLang}
              disabled={busy}
              onChange={(event) => onChange({ ...value, combinedInputFallbackLang: event.target.value })}
              className="h-10 w-full border border-line bg-bg px-2.5 text-fg outline-none disabled:opacity-50"
            >
              {value.languages.filter((row) => row.inputEnabled).map((row) => (
                <option key={row.lang} value={row.lang}>{languageByCode.get(row.lang)?.label ?? row.lang}</option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-2.5 border-t border-line pt-5">
        <label className="min-w-[180px] flex-1 font-mono text-[11px] text-muted sm:max-w-[260px]">
          <span className="mb-1.5 block">{strings.settings.presetName}</span>
          <input
            value={presetName}
            maxLength={80}
            disabled={busy}
            onChange={(event) => setPresetName(event.target.value)}
            className="h-10 w-full border border-line bg-bg px-2.5 text-fg outline-none disabled:opacity-50"
          />
        </label>
        <button type="button" onClick={() => void savePreset()} disabled={busy || !presetName.trim()} className="min-h-10 cursor-pointer border border-line px-4 font-mono text-[11px] hover:border-fg disabled:cursor-default disabled:opacity-30">
          {selectedCustom ? strings.settings.updatePreset : strings.settings.savePreset}
        </button>
        {selectedCustom ? (
          <button type="button" onClick={() => void removePreset()} disabled={busy} className="min-h-10 cursor-pointer border border-line px-4 font-mono text-[11px] text-muted hover:border-fg hover:text-fg disabled:cursor-default disabled:opacity-30">
            {strings.settings.deletePreset}
          </button>
        ) : null}
      </div>
      {notice ? <p className="mt-3 font-mono text-[11px] text-muted">{notice}</p> : null}
      {error ? <p className="mt-3 font-mono text-[11px] text-fg">{error}</p> : null}
    </section>
  );
}

export function TranscriptionContextSettings({
  meetingId,
  initialContext,
  strings,
}: {
  meetingId: string;
  initialContext: string | null;
  strings: AdminStrings;
}) {
  const [context, setContext] = useState(initialContext ?? "");
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const save = async () => {
    if (pending) return;
    setPending(true);
    setNotice(null);
    try {
      const response = await fetch(`/api/meetings/${meetingId}/transcription-context`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ context: context.trim() || null }),
      });
      setNotice(response.ok ? strings.settings.saved : strings.settings.saveFailed);
    } catch {
      setNotice(strings.settings.saveFailed);
    } finally {
      setPending(false);
    }
  };

  return (
    <section data-guide="transcription-context" className="mt-9 border-y border-line py-5">
      <label className="block font-mono text-[11px] text-muted">
        <span className="block text-fg">{strings.settings.transcriptionContext}</span>
        <span className="mt-1 block leading-5">{strings.settings.transcriptionContextNote}</span>
        <textarea
          value={context}
          maxLength={300}
          rows={2}
          disabled={pending}
          onChange={(event) => setContext(event.target.value)}
          placeholder={strings.settings.transcriptionContextPlaceholder}
          className="mt-2 w-full border border-line bg-bg px-2.5 py-2 text-[12px] leading-5 text-fg outline-none disabled:opacity-50"
        />
      </label>
      <button type="button" onClick={() => void save()} disabled={pending} className="mt-2 min-h-9 cursor-pointer border border-line px-3 font-mono text-[11px] hover:border-fg disabled:cursor-default disabled:opacity-30">
        {pending ? strings.settings.saving : strings.settings.contextSave}
      </button>
      {notice ? <p className="mt-3 font-mono text-[11px] text-muted">{notice}</p> : null}
    </section>
  );
}
