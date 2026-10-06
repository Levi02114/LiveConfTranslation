import type zoomSdk from "@zoom/appssdk";
import type { ZoomStatus } from "./zoom-contract";

type CaptureSdk = Pick<typeof zoomSdk, "getRunningContext" | "getMeetingUUID" | "startRTMS" | "stopRTMS">;

/** Read title and instance together; a meeting switch must not mix their identities. */
export async function readZoomMeeting(sdk: Pick<typeof zoomSdk, "getRunningContext" | "getMeetingUUID" | "getMeetingContext">, untitled: string) {
  if ((await sdk.getRunningContext()).context !== "inMeeting") throw new Error("zoomRequired");
  const before = await sdk.getMeetingUUID();
  const context = await sdk.getMeetingContext();
  const after = await sdk.getMeetingUUID();
  if (before.meetingUUID !== after.meetingUUID || (await sdk.getRunningContext()).context !== "inMeeting") throw new Error("zoomRequired");
  return { uuid: before.meetingUUID, title: (context.meetingTopic.trim() || untitled).slice(0, 200) };
}

async function isBoundMeeting(sdk: CaptureSdk, meeting: string) {
  return (await sdk.getRunningContext()).context === "inMeeting" && (await sdk.getMeetingUUID()).meetingUUID === meeting;
}

/** Never stop a different meeting after the operator changes Zoom context. */
export async function stopZoomCapture(sdk: CaptureSdk, meeting: string) {
  if (await isBoundMeeting(sdk, meeting)) {
    if ((await sdk.stopRTMS()).message !== "Success") throw new Error("stopFailed");
  }
}

/** A native start cannot be aborted; undo a late success before publishing it. */
export async function startZoomCapture(sdk: CaptureSdk, meeting: string, signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("", "AbortError");
  if (!(await isBoundMeeting(sdk, meeting))) throw new Error("zoomRequired");
  if (signal.aborted) throw new DOMException("", "AbortError");
  try {
    if ((await sdk.startRTMS()).message !== "Success") throw new Error("requestFailed");
    if (signal.aborted) throw new DOMException("", "AbortError");
    if (!(await isBoundMeeting(sdk, meeting))) throw new Error("zoomRequired");
    if (signal.aborted) throw new DOMException("", "AbortError");
  } catch (error) {
    await stopZoomCapture(sdk, meeting).catch(() => {});
    throw error;
  }
}

/** Owns one run's chat ACK, including when its HTTP response is lost. */
export class ZoomChatDelivery {
  ack = 0;
  private uncertain = false;

  constructor(private meeting: string, private sdk: Pick<typeof zoomSdk, "getRunningContext" | "getMeetingUUID" | "sendMessageToChat">) {}

  async deliver(next: NonNullable<ZoomStatus["next"]>, active: () => boolean) {
    if (this.uncertain) throw new Error("sendUncertain");
    if (next.sequence <= this.ack || !active()) return;
    try {
      const context = await this.sdk.getRunningContext();
      const meeting = await this.sdk.getMeetingUUID();
      if (context.context !== "inMeeting" || meeting.meetingUUID !== this.meeting) throw new Error("sendUncertain");
      if (!active()) return;
      const response = await this.sdk.sendMessageToChat({ message: next.text });
      if (!response.result.length) throw new Error("sendUncertain");
      this.ack = next.sequence;
    } catch {
      // Zoom has no idempotency key here. An ambiguous result must never be retried.
      this.uncertain = true;
      throw new Error("sendUncertain");
    }
  }
}
