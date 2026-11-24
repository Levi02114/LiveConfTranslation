"use client";

import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { SYSTEM_AUDIO_DEVICE, useServerVoiceInput } from "@/hooks/use-combined-voice-input";
import type { AdminStrings, UiStrings } from "@/lib/i18n-builtin";
import type { Language } from "@/lib/languages";
import { DEFAULT_VOICE_SETTINGS, silenceMsFor, voiceSettingsSchema, type VoiceSettings } from "@/lib/voice-settings";
import { engineIdSchema, type EngineId } from "@/lib/translate/types";
import { transcriptionProviderSchema } from "@/lib/repo-schema";
import { useConfirmation } from "@/components/confirm-dialog";
import { voiceLevelHint } from "@/components/voice-level-meter";

const translationSchema = z.object({ text: z.string(), elapsedMs: z.number() });
type Result = { id: number; body: string; elapsedMs: number; silenceMs: number; text?: string; translationMs?: number; error?: boolean };

export function VoiceSettingsForm({ initial, strings, ui, languages, engines }: {
  initial: VoiceSettings; strings: AdminStrings; ui: UiStrings; languages: Language[];
  engines: { id: EngineId; label: string; configured: boolean }[];
}) {
  const s = strings.appSettings;
  const [settings, setSettings] = useState(initial);
  const edited = useRef(new Set<string>());
  const { confirm, confirmation } = useConfirmation({ confirm: ui.speaker.confirm, cancel: ui.message.cancel });
  const [source, setSource] = useState(languages[0]?.code ?? "ko");
  const selected = source ? settings.languages?.[source] ?? settings : settings.automaticLanguage;
  const testLangs = source ? [source] : languages.map((lang) => lang.code);
  const delay = silenceMsFor(settings, testLangs, !source);
  const changeSelected = (value: { mode: "auto" | "manual"; silenceMs: number }) => {
    edited.current.add(source);
    setSettings((current) => source ? { ...current, languages: { ...current.languages, [source]: value } } : { ...current, automaticLanguage: value });
  };
  const changeMaxTurn = (maxTurnMs: number) => {
    edited.current.add("maxTurnMs"); setSettings((current) => ({ ...current, maxTurnMs }));
  };
  const changeNoiseGate = (noiseGateLevel: number) => {
    edited.current.add("noiseGateLevel"); setSettings((current) => ({ ...current, noiseGateLevel }));
  };
  const [target, setTarget] = useState(languages[1]?.code ?? "vi");
  const [provider, setProvider] = useState<"openai" | "google" | "local">("openai");
  const [engine, setEngine] = useState<EngineId>(engines.find((item) => item.configured)?.id ?? "openai");
  const [dry, setDry] = useState(true);
  const [results, setResults] = useState<Result[]>([]);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState("");
  const abort = useRef<AbortController | null>(null);
  const sequence = useRef(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/admin/voice-settings", { signal: controller.signal }).then(async (response) => {
      const parsed = voiceSettingsSchema.safeParse(await response.json());
      if (!response.ok || !parsed.success) throw new Error();
      if (!controller.signal.aborted) setSettings((current) => ({ ...parsed.data,
        maxTurnMs: edited.current.has("maxTurnMs") ? current.maxTurnMs : parsed.data.maxTurnMs,
        automaticLanguage: edited.current.has("") ? current.automaticLanguage : parsed.data.automaticLanguage,
        noiseGateLevel: edited.current.has("noiseGateLevel") ? current.noiseGateLevel : parsed.data.noiseGateLevel,
        languages: {
        ...parsed.data.languages,
        ...Object.fromEntries(Object.entries(current.languages ?? {}).filter(([code]) => edited.current.has(code))),
      } }));
      if (!controller.signal.aborted) setLoaded(true);
    }).catch(() => { if (!controller.signal.aborted) setNotice(strings.security.failed); });
    return () => controller.abort();
  }, [strings.security.failed]);
  useEffect(() => () => abort.current?.abort(), []);
  const voice = useServerVoiceInput({ token: "", langs: testLangs, automaticLanguage: !source, strings: ui.capture, closed: false,
    autoSubmit: false, requestPermissionOnMount: false,
    test: { dry, provider, settings, onSegment: async (result) => {
      const controller = abort.current;
      if (!controller || controller.signal.aborted) return;
      const id = ++sequence.current;
      setResults((rows) => [...rows.slice(-19), { ...result, id }]);
      if (dry || !result.body.trim()) return;
      try {
        const response = await fetch("/api/admin/voice-test", { method: "POST", headers: { "content-type": "application/json" },
          signal: controller.signal, body: JSON.stringify({ text: result.body, from: result.lang ?? source, to: target, engine }) });
        const parsed = translationSchema.safeParse(await response.json());
        if (!response.ok || !parsed.success) throw new Error();
        if (!controller.signal.aborted) setResults((rows) => rows.map((row) => row.id === id ? { ...row, text: parsed.data.text, translationMs: parsed.data.elapsedMs } : row));
      } catch {
        if (!controller.signal.aborted) setResults((rows) => rows.map((row) => row.id === id ? { ...row, error: true } : row));
      }
    } },
  });
  const levelHint = voice.meter ? voiceLevelHint(voice.meter, ui.capture, voice.deviceId === SYSTEM_AUDIO_DEVICE) : null;
  return <section className="grid gap-4">
    {confirmation}
    <h2>{s.voice}</h2>
    <label>{s.source}<select disabled={voice.state !== "idle"} value={source} onChange={(event) => setSource(event.target.value)}><option value="">{s.automaticLanguage}</option>{languages.map((lang) => <option key={lang.code} value={lang.code}>{lang.label}</option>)}</select></label>
    <p className="text-muted">{s.perLanguage}</p>
    <label>{s.delay}
      <select value={selected.mode} onChange={(event) => changeSelected({ silenceMs: selected.silenceMs, mode: event.target.value === "manual" ? "manual" : "auto" })}>
        <option value="auto">{s.auto}</option><option value="manual">{s.manual}</option>
      </select>
    </label>
    <label>{s.delay} · {delay} ms
      <input className="accent-fg" aria-label={s.delay} type="range" min={300} max={5000} step={100} disabled={selected.mode === "auto"}
        value={delay} onChange={(event) => changeSelected({ mode: selected.mode, silenceMs: Number(event.target.value) })} />
      <input aria-label={s.manual} type="number" min={300} max={5000} step={100} disabled={selected.mode === "auto"}
        value={Number.isNaN(delay) ? "" : delay} onChange={(event) => changeSelected({ mode: selected.mode, silenceMs: event.currentTarget.valueAsNumber })} />
    </label>
    <p className="text-muted">{s.note}</p>
    <label>{s.noiseGate}
      <input className="accent-fg" type="range" min={0} max={100} step={1} disabled={saving} aria-label={s.noiseGate} aria-describedby="voice-noise-gate-note"
        value={Number.isNaN(settings.noiseGateLevel) ? 0 : settings.noiseGateLevel} onChange={(event) => changeNoiseGate(Number(event.target.value))} />
      <input type="number" min={0} max={100} step={1} disabled={saving} aria-label={s.noiseGate} aria-describedby="voice-noise-gate-note"
        value={Number.isNaN(settings.noiseGateLevel) ? "" : settings.noiseGateLevel} onChange={(event) => changeNoiseGate(event.currentTarget.valueAsNumber)} />
    </label>
    <p id="voice-noise-gate-note" className="text-muted">{s.noiseGateNote}</p>
    <button className="justify-self-start" disabled={saving} onClick={() => changeNoiseGate(DEFAULT_VOICE_SETTINGS.noiseGateLevel)}>{s.resetNoiseGate}</button>
    <label>{s.maxTurn}
      <input type="number" min={5} max={30} step={1} disabled={saving} aria-describedby="voice-max-turn-note"
        value={Number.isNaN(settings.maxTurnMs) ? "" : settings.maxTurnMs / 1000}
        onChange={(event) => changeMaxTurn(event.currentTarget.valueAsNumber * 1000)} />
    </label>
    <p id="voice-max-turn-note" className="text-muted">{s.maxTurnNote}</p>
    <button className="justify-self-start" disabled={saving} onClick={() => changeMaxTurn(DEFAULT_VOICE_SETTINGS.maxTurnMs)}>{s.resetMaxTurn}</button>
    <p className="text-muted">{s.nextTurn}</p>
    <div className="flex flex-wrap gap-2">
      <button disabled={!loaded || saving || !voiceSettingsSchema.safeParse(settings).success} onClick={async () => {
        if (!loaded || saving) return;
        setSaving(true); setNotice("");
        try {
          const response = await fetch("/api/admin/voice-settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(settings) });
          if (!response.ok) throw new Error();
          setNotice(strings.security.saved);
        } catch { setNotice(strings.security.failed); }
        finally { setSaving(false); }
      }}>{saving ? strings.security.saving : strings.security.save}</button>
      <button disabled={saving} onClick={() => changeSelected({ mode: DEFAULT_VOICE_SETTINGS.mode, silenceMs: DEFAULT_VOICE_SETTINGS.silenceMs })}>{s.reset}</button>
    </div>
    <p role="status">{notice}</p>
    <fieldset disabled={voice.state !== "idle"} className="grid gap-3 border-t border-line pt-4">
      <label>{ui.capture.microphone}<select value={voice.deviceId} onChange={(event) => voice.setDeviceId(event.target.value)}>
        <option value="">{ui.capture.microphone}</option>
        {voice.devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `${ui.capture.microphone} ${index + 1}`}</option>)}
        {voice.systemAudio ? <option value={SYSTEM_AUDIO_DEVICE}>{ui.capture.systemAudio}</option> : null}
      </select></label>
      <label><input type="radio" name="voice-test-mode" checked={dry} onChange={() => setDry(true)} /> {s.dry}</label>
      <label><input type="radio" name="voice-test-mode" checked={!dry} onChange={() => setDry(false)} /> {s.paid}</label>
      {!dry ? <>
        <p>{s.paidWarning}</p>
        <label>{strings.list.transcriptionProvider}<select value={provider} onChange={(event) => setProvider(transcriptionProviderSchema.parse(event.target.value))}>
          <option value="openai">{strings.list.transcriptionOpenai}</option><option value="google">{strings.list.transcriptionGoogle}</option><option value="local">{strings.list.transcriptionLocal}</option>
        </select></label>
        <label>{s.target}<select value={target} onChange={(event) => setTarget(event.target.value)}>{languages.map((lang) => <option key={lang.code} value={lang.code}>{lang.label}</option>)}</select></label>
        <label>{strings.list.engine}<select value={engine} onChange={(event) => setEngine(engineIdSchema.parse(event.target.value))}>{engines.map((item) => <option key={item.id} value={item.id} disabled={!item.configured}>{item.label}{!item.configured ? ` · ${item.id === "local" ? strings.list.notInstalled : strings.list.engineNoKey}` : ""}</option>)}</select></label>
      </> : null}
    </fieldset>
    <div className="flex flex-wrap gap-2">
      <button disabled={voice.state !== "idle" || !voiceSettingsSchema.safeParse(settings).success || (!dry && !engines.some((item) => item.id === engine && item.configured))} onClick={async () => {
        if (!dry && !await confirm(s.paidWarning)) return;
        abort.current?.abort(); abort.current = new AbortController(); setResults([]); void voice.start();
      }}>{voice.state === "starting" ? ui.capture.starting : ui.capture.start}</button>
      <button disabled={voice.state === "idle" || voice.state === "stopping"} onClick={() => { abort.current?.abort(); voice.stop(false); }}>{voice.state === "stopping" ? ui.capture.stopping : ui.capture.stop}</button>
    </div>
    <div className="relative">
      <meter min={0} max={1} value={voice.meter?.level ?? 0} aria-label={ui.capture.level} className="w-full [&::-webkit-meter-bar]:border-line [&::-webkit-meter-bar]:bg-panel [&::-webkit-meter-optimum-value]:bg-fg [&::-moz-meter-bar]:bg-fg" />
      {settings.noiseGateLevel > 0 && settings.noiseGateLevel <= 100 ? <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 border-l-2 border-fg" style={{ left: `${settings.noiseGateLevel}%` }} /> : null}
    </div>
    <p className="text-muted">{s.noiseGateMeter.replace("{level}", String(Math.round((voice.meter?.level ?? 0) * 100))).replace("{threshold}", String(Number.isNaN(settings.noiseGateLevel) ? "—" : settings.noiseGateLevel))}</p>
    <p role="status">{voice.state === "stopping" ? ui.capture.stopping : voice.phase === "idle" ? ui.capture.standby : s[voice.phase]}</p>
    {levelHint ? <p>{levelHint}</p> : null}
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
