import { voiceErrorType } from "./client-diagnostics";

/** 모델 해제·AudioContext 종료가 멈춰도 마이크 상태가 "정지 중"에 갇히지 않게 하는 상한. */
export const RELEASE_STAGE_TIMEOUT_MS = 4_000;

export type VoiceAudioResources = {
  stream: { getTracks: () => { stop: () => void }[] } | null;
  processor: { port: Pick<MessagePort, "onmessage" | "close">; disconnect: () => void } | null;
  nodes: Pick<AudioNode, "disconnect">[];
  vad: Promise<{ destroy: () => Promise<void> } | null> | null;
  context: Pick<AudioContext, "close"> | null;
};

/** Detach producers immediately, then release the model before closing its shared context. */
export async function releaseVoiceAudio(resources: VoiceAudioResources,
  report: (phase: string, fields: { durationMs?: number; errorType?: string }) => void): Promise<void> {
  const stage = async (phase: string, action: () => void | Promise<void>, timeoutMs?: number) => {
    const started = performance.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = Symbol("timeout");
    try {
      const result = await (timeoutMs
        ? Promise.race([Promise.resolve().then(action), new Promise<typeof timedOut>((resolve) => { timer = setTimeout(() => resolve(timedOut), timeoutMs); })])
        : action());
      report(result === timedOut ? `${phase}-timeout` : `${phase}-done`, { durationMs: Math.round(performance.now() - started) });
    } catch (error) { report(`${phase}-failed`, { errorType: voiceErrorType(error) }); }
    finally { clearTimeout(timer); }
  };
  // Start every synchronous detachment before the first await; no more audio/UI frames may escape.
  const detached = [stage("pcm-detach", () => {
    if (resources.processor) { resources.processor.port.onmessage = null; resources.processor.port.close(); }
  })];
  detached.push(stage("track-stop", async () => {
    await Promise.all((resources.stream?.getTracks() ?? []).map((track) => stage("track-stop", () => track.stop())));
  }));
  for (const node of [resources.processor, ...resources.nodes]) {
    if (node) detached.push(stage("node-disconnect", () => node.disconnect()));
  }
  await Promise.all(detached);
  // VAD initialization also owns this context; closing it mid-initialization can leak the model.
  await stage("vad-destroy", async () => { const vad = await resources.vad; await vad?.destroy(); }, RELEASE_STAGE_TIMEOUT_MS);
  await stage("context-close", async () => { await resources.context?.close(); }, RELEASE_STAGE_TIMEOUT_MS);
}
