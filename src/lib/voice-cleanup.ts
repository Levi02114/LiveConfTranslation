import { voiceErrorType } from "./client-diagnostics";

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
  const stage = async (phase: string, action: () => void | Promise<void>) => {
    const started = performance.now();
    try { await action(); report(`${phase}-done`, { durationMs: Math.round(performance.now() - started) }); }
    catch (error) { report(`${phase}-failed`, { errorType: voiceErrorType(error) }); }
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
  await stage("vad-destroy", async () => { const vad = await resources.vad; await vad?.destroy(); });
  await stage("context-close", async () => { await resources.context?.close(); });
}
