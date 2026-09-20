import "server-only";

import { publish } from "@/lib/realtime/hub";
import { providerStatus } from "@/lib/translate/provider-control";
import {
  claimTranslationJob, finishTranslationJob, getMeeting, getRecentSourceBodies,
  getSecurityLimits, getTranslationJobCounts, nextTranslationJobTime,
  recoverTranslationJobs, renewTranslationJob, rescheduleTranslationJob,
  translationJobMessage, type TranslationJob,
} from "@/lib/repo";
import { ENGINE_IDS, TranslationError, isTransientTranslationError, translateText, type EngineId } from "@/lib/translate";

type Worker = {
  timer?: ReturnType<typeof setTimeout>;
  active: Map<number, { job: TranslationJob; abort: AbortController }>;
  pumping: boolean;
  stopped: boolean;
};
type JobResult = { body: string; engine: EngineId; error?: string };
declare global { var __translationWorker: Worker | undefined; }

export function publishJobCounts(meetingId: string): void {
  publish(meetingId, { t: "translation-jobs", counts: getTranslationJobCounts(meetingId), providers: providerStatus() });
}

export function cancelActiveTranslations(meetingId: string, messageId?: number): void {
  for (const entry of globalThis.__translationWorker?.active.values() ?? []) {
    if (entry.job.meeting_id === meetingId && (messageId === undefined || entry.job.message_id === messageId)) entry.abort.abort();
  }
}

async function execute(worker: Worker, job: TranslationJob, abort: AbortController): Promise<void> {
  const heartbeat = setInterval(() => {
    if (!renewTranslationJob(job)) abort.abort();
  }, 30000);
  heartbeat.unref();
  try {
    const message = translationJobMessage(job);
    const meeting = getMeeting(job.meeting_id);
    if (!message || !meeting) return;
    let result: JobResult;
    try {
      const translated = await translateText(job.engine, {
        text: message.body, from: message.lang, to: job.target_lang,
        model: meeting.translationModel, signal: abort.signal,
        context: job.engine === "openai" || meeting.fallbackEngine === "openai"
          ? getRecentSourceBodies(meeting.id, message.id) : undefined,
      }, meeting.fallbackEngine);
      if (abort.signal.aborted) return;
      result = { body: translated.text, engine: translated.engine };
    } catch (error) {
      if (abort.signal.aborted) return;
      const code = error instanceof TranslationError ? error.code ?? "translation-failed" : "translation-failed";
      const waiting = code === "provider-busy" || code === "provider-paused";
      if (waiting || (job.attempts < 3 && isTransientTranslationError(error))) {
        const delay = error instanceof TranslationError && error.retryAfterMs !== undefined ? error.retryAfterMs :
          (job.attempts === 1 ? 2000 : 10000) + Math.floor(Math.random() * 500);
        rescheduleTranslationJob(job, code, Math.max(100, delay), !waiting);
        return;
      }
      result = { body: "", engine: error instanceof TranslationError ? error.engine : job.engine, error: code };
    }
    const createdAt = finishTranslationJob(job, result);
    if (createdAt === null) return;
    publish(meeting.id, {
      t: "translation", messageId: message.id, sourceLang: message.lang, lang: job.target_lang,
      body: result.body, speakerName: message.speakerName, engine: result.engine,
      status: result.error ? "error" : "ok", error: result.error,
      revision: message.revision, editedAt: message.editedAt,
      sourceCreatedAt: message.createdAt, createdAt,
    });
  } finally {
    clearInterval(heartbeat);
    worker.active.delete(job.id);
    publishJobCounts(job.meeting_id);
    wakeTranslationWorker();
  }
}

/** Event-driven worker. Only the next retry/expired lease owns a timer. */
export function wakeTranslationWorker(): void {
  const worker = globalThis.__translationWorker;
  if (!worker || worker.stopped || worker.pumping) return;
  if (worker.timer) clearTimeout(worker.timer);
  worker.timer = undefined;
  worker.pumping = true;
  try {
    recoverTranslationJobs();
    const limits = getSecurityLimits();
    const available = () => ENGINE_IDS.filter((engine) =>
      [...worker.active.values()].filter((entry) => entry.job.engine === engine).length <
      (engine === "local" ? limits.translationLocal : limits.translationOnline));
    for (;;) {
      const job = claimTranslationJob(available());
      if (!job) break;
      const abort = new AbortController();
      worker.active.set(job.id, { job, abort });
      publishJobCounts(job.meeting_id);
      void execute(worker, job, abort).catch(() => {
        // Keep the durable lease for recovery; never leak provider data to the logs.
        console.error("[translation-worker] job-processing-failed");
      });
    }
    const next = nextTranslationJobTime(available());
    if (next !== null) {
      worker.timer = setTimeout(wakeTranslationWorker, Math.min(2147483647, Math.max(100, next - Date.now())));
      worker.timer.unref();
    }
  } finally {
    worker.pumping = false;
  }
}

export function startTranslationWorker(): void {
  if (globalThis.__translationWorker && !globalThis.__translationWorker.stopped) return;
  globalThis.__translationWorker = { active: new Map(), pumping: false, stopped: false };
  wakeTranslationWorker();
}

export function stopTranslationWorker(): void {
  const worker = globalThis.__translationWorker;
  if (!worker) return;
  worker.stopped = true;
  if (worker.timer) clearTimeout(worker.timer);
  for (const { abort } of worker.active.values()) abort.abort();
}
