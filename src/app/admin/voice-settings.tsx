"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { useServerVoiceInput } from "@/hooks/use-combined-voice-input";
import type { AdminStrings, UiStrings } from "@/lib/i18n-builtin";
import type { Language } from "@/lib/languages";
import { DEFAULT_VOICE_SETTINGS, silenceMsFor, voiceSettingsSchema, type VoiceSettings } from "@/lib/voice-settings";
import { engineIdSchema, type EngineId } from "@/lib/translate/types";
import { transcriptionProviderSchema } from "@/lib/repo-schema";

const translationSchema = z.object({ text: z.string(), elapsedMs: z.number() });
type Result = { id: number; body: string; elapsedMs: number; silenceMs: number; text?: string; translationMs?: number; error?: boolean };

export function VoiceSettingsForm({ initial, strings, ui, languages, engines }: {
  initial: VoiceSettings; strings: AdminStrings; ui: UiStrings; languages: Language[];
  engines: { id: EngineId; label: string; configured: boolean }[];
}) {
  const s = strings.appSettings;
  const [settings, setSettings] = useState(initial);
  const [source, setSource] = useState(languages[0]?.code ?? "ko");
  const selected = settings.languages?.[source] ?? settings;
  const changeSelected = (value: { mode: "auto" | "manual"; silenceMs: number }) => setSettings({
    ...settings, languages: { ...settings.languages, [source]: value },
  });
  const [target, setTarget] = useState(languages[1]?.code ?? "vi");
  const [provider, setProvider] = useState<"openai" | "google" | "local">("openai");
  const [engine, setEngine] = useState<EngineId>(engines.find((item) => item.configured)?.id ?? "openai");
  const [dry, setDry] = useState(true);
  const [results, setResults] = useState<Result[]>([]);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const abort = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/voice-settings", { signal: controller.signal }).then(async (response) => {
      const parsed = voiceSettingsSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error();
      setSettings(parsed.data);
    }).catch(() => { if (!controller.signal.aborted) setNotice(strings.security.failed); });
    return () => controller.abort();
  }, [strings.security.failed]);
  useEffect(() => () => abort.current?.abort(), []);
  const voice = useServerVoiceInput({ token: "", langs: [source], strings: ui.capture, closed: false,
    autoSubmit: false, requestPermissionOnMount: false,
    test: { dry, provider, settings, onSegment: async (result) => {
      const controller = abort.current;
      if (!controller || controller.signal.aborted) return;
      const id = ++sequence.current;
      setResults((rows) => [...rows.slice(-19), { ...result, id }]);
      if (dry || !result.body.trim()) return;
      try {
        const response = await fetch("/api/admin/voice-test", { method: "POST", headers: { "content-type": "application/json" },
          signal: controller.signal, body: JSON.stringify({ text: result.body, from: source, to: target, engine }) });
        const parsed = translationSchema.safeParse(await response.json());
        if (!response.ok || !parsed.success) throw new Error();
        if (!controller.signal.aborted) setResults((rows) => rows.map((row) => row.id === id ? { ...row, text: parsed.data.text, translationMs: parsed.data.elapsedMs } : row));
      } catch {
        if (!controller.signal.aborted) setResults((rows) => rows.map((row) => row.id === id ? { ...row, error: true } : row));
      }
    } },
  });
  return <section className="grid gap-4">
    <h2>{s.voice}</h2>
    <label>{s.source}<select disabled={voice.state !== "idle"} value={source} onChange={(event) => setSource(event.target.value)}>{languages.map((lang) => <option key={lang.code} value={lang.code}>{lang.label}</option>)}</select></label>
    <p className="text-muted">{s.perLanguage}</p>
    <label>{s.delay}
      <select value={selected.mode} onChange={(event) => changeSelected({ silenceMs: selected.silenceMs, mode: event.target.value === "manual" ? "manual" : "auto" })}>
        <option value="auto">{s.auto}</option><option value="manual">{s.manual}</option>
      </select>
    </label>
    <label>{s.delay} · {silenceMsFor(settings, [source])} ms
      <input aria-label={s.delay} type="range" min={300} max={5000} step={100} disabled={selected.mode === "auto"}
        value={silenceMsFor(settings, [source])} onChange={(event) => changeSelected({ mode: selected.mode, silenceMs: Number(event.target.value) })} />
      <input aria-label={s.manual} type="number" min={300} max={5000} step={100} disabled={selected.mode === "auto"}
        value={selected.mode === "auto" ? silenceMsFor(settings, [source]) : selected.silenceMs} onChange={(event) => changeSelected({ mode: selected.mode, silenceMs: event.currentTarget.valueAsNumber })} />
    </label>
    <p className="text-muted">{s.note}</p><p className="text-muted">{s.nextTurn}</p>
    <div className="flex flex-wrap gap-2">
      <button disabled={saving || !voiceSettingsSchema.safeParse(settings).success} onClick={async () => {
        if (saving) return;
        setSaving(true); setNotice("");
        try {
          const response = await fetch("/api/admin/voice-settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(settings) });
          if (!response.ok) throw new Error();
          setNotice(strings.security.saved);
        } catch { setNotice(strings.security.failed); }
        finally { setSaving(false); }
      }}>{saving ? strings.security.saving : strings.security.save}</button>
      <button disabled={saving} onClick={() => changeSelected({ ...DEFAULT_VOICE_SETTINGS })}>{s.reset}</button>
    </div>
    <p role="status">{notice}</p>
    <fieldset disabled={voice.state !== "idle"} className="grid gap-3 border-t border-line pt-4">
      <label>{ui.capture.microphone}<select value={voice.deviceId} onChange={(event) => voice.setDeviceId(event.target.value)}>
        <option value="">{ui.capture.microphone}</option>
        {voice.devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${ui.capture.microphone} ${index + 1}`}</option>)}
      </select></label>
      <label><input type="radio" name="voice-test-mode" checked={dry} onChange={() => setDry(true)} /> {s.dry}</label>
      <label><input type="radio" name="voice-test-mode" checked={!dry} onChange={() => setDry(false)} /> {s.paid}</label>
      {!dry ? <>
        <p>{s.paidWarning}</p>
        <label>{strings.list.transcriptionProvider}<select value={provider} onChange={(event) => setProvider(transcriptionProviderSchema.parse(event.target.value))}>
          <option value="openai">{strings.list.transcriptionOpenai}</option><option value="google">{strings.list.transcriptionGoogle}</option><option value="local">{strings.list.transcriptionLocal}</option>
        </select></label>
        <label>{s.target}<select value={target} onChange={(event) => setTarget(event.target.value)}>{languages.map((lang) => <option key={lang.code} value={lang.code}>{lang.label}</option>)}</select></label>
        <label>{strings.list.engine}<select value={engine} onChange={(event) => setEngine(engineIdSchema.parse(event.target.value))}>{engines.map((item) => <option key={item.id} value={item.id} disabled={!item.configured}>{item.label}</option>)}</select></label>
      </> : null}
    </fieldset>
    <div className="flex flex-wrap gap-2">
      <button disabled={voice.state !== "idle" || !voiceSettingsSchema.safeParse(settings).success} onClick={() => {
        if (!dry && !window.confirm(s.paidWarning)) return;
        abort.current?.abort(); abort.current = new AbortController(); setResults([]); void voice.start();
      }}>{voice.state === "starting" ? ui.capture.starting : ui.capture.start}</button>
      <button disabled={voice.state === "idle"} onClick={() => { abort.current?.abort(); voice.stop(false); }}>{ui.capture.stop}</button>
    </div>
    <meter min={0} max={1} value={voice.meter?.level ?? 0} aria-label={ui.capture.level} className="w-full" />
    <p role="status">{voice.phase === "idle" ? ui.capture.standby : s[voice.phase]}</p>
    {voice.meter?.noSignal ? <p>{ui.capture.noSignal}</p> : voice.meter?.clipping ? <p>{ui.capture.levelClipping}</p> : voice.meter?.tooQuiet ? <p>{ui.capture.levelTooQuiet}</p> : null}
    {voice.error ? <p role="alert">{voice.error}</p> : null}
    {voice.partial ? <p>{voice.partial}</p> : null}
    <ol className="grid gap-3" aria-live="polite">{results.map((row) => <li key={row.id} className="border border-line p-3">
      <p>{s.segment} {row.id} · {row.silenceMs} ms</p>
      {row.body ? <p>{row.body}</p> : null}{row.text ? <p>{row.text}</p> : null}
      {!dry ? <p className="text-muted">{s.transcriptionMs}: {Math.round(row.elapsedMs)} ms · {s.translationMs}: {row.translationMs === undefined ? "—" : `${row.translationMs} ms`}</p> : null}
      {row.error ? <p role="alert">{strings.security.failed}</p> : null}
    </li>)}</ol>
  </section>;
}
