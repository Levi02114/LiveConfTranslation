import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname } from "node:path";
import { availableParallelism } from "node:os";

import {
  localAiUseGpu,
  localLlamaServerPath,
  localTranscriptionModelPath,
  localTranslationModelId,
  localTranslationModelPath,
  localWhisperServerPath,
} from "@/lib/env";

declare global {
  var __localAiRuntimes:
    | { translation: ChildProcess | null; transcription: ChildProcess | null }
    | undefined;
}

const state = (globalThis.__localAiRuntimes ??= { translation: null, transcription: null });
const TRANSLATION_ORIGIN = "http://127.0.0.1:3031";
const TRANSCRIPTION_ORIGIN = "http://127.0.0.1:3032";

function validFile(path: string | undefined): path is string {
  return Boolean(path && existsSync(path));
}

export function localTranslationConfigured(): boolean {
  return validFile(localLlamaServerPath()) && validFile(localTranslationModelPath());
}

export function localTranscriptionConfigured(): boolean {
  return validFile(localWhisperServerPath()) && validFile(localTranscriptionModelPath());
}

export function configuredLocalTranslationModel(): string | null {
  return localTranslationConfigured()
    ? (localTranslationModelId() ?? basename(localTranslationModelPath()!))
    : null;
}

async function waitFor(url: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const attempts = Math.ceil(timeoutMs / 250);
  let spawnError: Error | null = null;
  const onError = (error: Error) => { spawnError = error; };
  child.once("error", onError);
  try {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null) throw new Error(`로컬 AI 프로세스가 종료되었습니다 (${child.exitCode})`);
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(500) });
        if (response.ok) return;
      } catch {
        // 모델 로딩 중이다.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } finally {
    child.off("error", onError);
  }
  child.kill();
  throw new Error(`로컬 AI 모델을 ${Math.ceil(timeoutMs / 1000)}초 안에 시작하지 못했습니다`);
}

function logChild(name: string, child: ChildProcess) {
  child.stdout?.on("data", (chunk) => console.log(`[${name}] ${String(chunk).trimEnd()}`));
  child.stderr?.on("data", (chunk) => console.warn(`[${name}] ${String(chunk).trimEnd()}`));
}

export async function ensureLocalTranslationRuntime(): Promise<string> {
  if (!localTranslationConfigured()) throw new Error("로컬 번역 모델이 설치되지 않았습니다");
  if (state.translation?.exitCode === null) {
    await waitFor(`${TRANSLATION_ORIGIN}/health`, state.translation, 180_000);
    return TRANSLATION_ORIGIN;
  }

  const binary = localLlamaServerPath()!;
  const args = [
    "--model", localTranslationModelPath()!,
    "--alias", localTranslationModelId() ?? basename(localTranslationModelPath()!),
    "--host", "127.0.0.1",
    "--port", "3031",
    "--ctx-size", "2048",
    "--parallel", "1",
    "--no-jinja",
  ];
  if (localAiUseGpu()) args.push("--n-gpu-layers", "999", "--fit", "on");
  const child = spawn(binary, args, { cwd: dirname(binary), windowsHide: true });
  state.translation = child;
  logChild("local-translate", child);
  const clearTranslation = () => {
    if (state.translation === child) state.translation = null;
  };
  child.once("error", clearTranslation);
  child.once("exit", clearTranslation);
  await waitFor(`${TRANSLATION_ORIGIN}/health`, child, 180_000);
  return TRANSLATION_ORIGIN;
}

export async function ensureLocalTranscriptionRuntime(): Promise<string> {
  if (!localTranscriptionConfigured()) throw new Error("로컬 전사 모델이 설치되지 않았습니다");
  if (state.transcription?.exitCode === null) {
    await waitFor(`${TRANSCRIPTION_ORIGIN}/`, state.transcription, 60_000);
    return TRANSCRIPTION_ORIGIN;
  }

  const binary = localWhisperServerPath()!;
  const child = spawn(binary, [
    "--model", localTranscriptionModelPath()!,
    "--host", "127.0.0.1",
    "--port", "3032",
    "--language", "auto",
    "--no-timestamps",
    "--suppress-nst",
    "--threads", String(Math.max(1, Math.min(8, Math.floor(availableParallelism() / 2)))),
  ], { cwd: dirname(binary), windowsHide: true });
  state.transcription = child;
  logChild("local-transcribe", child);
  const clearTranscription = () => {
    if (state.transcription === child) state.transcription = null;
  };
  child.once("error", clearTranscription);
  child.once("exit", clearTranscription);
  await waitFor(`${TRANSCRIPTION_ORIGIN}/`, child, 60_000);
  return TRANSCRIPTION_ORIGIN;
}

function stopLocalRuntimes() {
  state.translation?.kill();
  state.transcription?.kill();
}

process.once("exit", stopLocalRuntimes);
