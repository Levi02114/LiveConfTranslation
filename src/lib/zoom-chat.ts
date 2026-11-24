import type zoomSdk from "@zoom/appssdk";
import type { ZoomStatus } from "./zoom-contract";

type CaptureSdk = Pick<typeof zoomSdk, "getRunningContext" | "getMeetingUUID" | "startRTMS" | "stopRTMS"> & Partial<Pick<typeof zoomSdk, "getRTMSStatus">>;

/** SDK 중지 응답(진단용 최소 정보). code는 ZoomApiError의 숫자 코드만 남긴다. */
export type ZoomStopReport = {
  /** 경고가 필요 없는지. Zoom 응답이나 상태 조회로 멈춘 것을 확인했거나, 다른 회의라 건드리지 않은(unbound) 경우다. */
  ok: boolean;
  response: "success" | "failure" | "rejected" | "timeout" | "unbound";
  code?: string;
  status?: "stopped" | "running" | "unknown";
};

/** Read title and instance together; a meeting switch must not mix their identities. */
export async function readZoomMeeting(sdk: Pick<typeof zoomSdk, "getRunningContext" | "getMeetingUUID" | "getMeetingContext">, untitled: string) {
  if ((await sdk.getRunningContext()).context !== "inMeeting") throw new Error("zoomRequired");
  const before = await sdk.getMeetingUUID();
  // 회의 제목(getMeetingContext)은 호스트·공동 호스트만 읽을 수 있다. 일반 참가자는 기본 이름으로 계속한다.
  const topic = await sdk.getMeetingContext().then((context) => context.meetingTopic.trim(), () => "");
  const after = await sdk.getMeetingUUID();
  if (before.meetingUUID !== after.meetingUUID || (await sdk.getRunningContext()).context !== "inMeeting") throw new Error("zoomRequired");
  return { uuid: before.meetingUUID, title: (topic || untitled).slice(0, 200) };
}

async function isBoundMeeting(sdk: CaptureSdk, meeting: string) {
  return (await sdk.getRunningContext()).context === "inMeeting" && (await sdk.getMeetingUUID()).meetingUUID === meeting;
}

// SDK 타입은 'Success' | 'Failure'지만 openUrl 같은 일부 경로는 소문자 'success'를 돌려준다.
const succeeded = (response: { message: string }) => String(response.message).toLowerCase() === "success";

/** 이 앱의 RTMS가 이 회의에서 실제로 멈췄는지 Zoom에 다시 묻는다. 확인하지 못하면 unknown이다. */
async function rtmsStatus(sdk: CaptureSdk, meeting: string): Promise<NonNullable<ZoomStopReport["status"]>> {
  try {
    if (!sdk.getRTMSStatus || !(await isBoundMeeting(sdk, meeting))) return "unknown";
    const { rtmsStatus } = await sdk.getRTMSStatus();
    return rtmsStatus.every((run) => run.status === "stopped") ? "stopped" : "running";
  } catch { return "unknown"; }
}

/**
 * Never stop a different meeting after the operator changes Zoom context.
 *
 * 중지 실패·오류 응답은 그대로 믿지 않고 getRTMSStatus로 실제 상태를 확인한다. 이미 끝난 스트림에
 * stopRTMS를 부르면 실패가 올 수 있어서다. 멈춘 것이 확인될 때만 ok다.
 */
export async function stopZoomCapture(sdk: CaptureSdk, meeting: string): Promise<ZoomStopReport> {
  if (!(await isBoundMeeting(sdk, meeting))) return { ok: true, response: "unbound" };
  const report: ZoomStopReport = { ok: false, response: "failure" };
  try {
    if (succeeded(await sdk.stopRTMS())) return { ok: true, response: "success" };
  } catch (error) {
    report.response = error instanceof Error && error.message.includes("took longer than") ? "timeout" : "rejected";
    const code = error instanceof Error && "code" in error ? String(error.code) : "";
    if (/^\d{1,8}$/.test(code)) report.code = code;
  }
  report.status = await rtmsStatus(sdk, meeting);
  report.ok = report.status === "stopped";
  return report;
}

/** A native start cannot be aborted; undo a late success before publishing it. */
export async function startZoomCapture(sdk: CaptureSdk, meeting: string, signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("", "AbortError");
  if (!(await isBoundMeeting(sdk, meeting))) throw new Error("zoomRequired");
  if (signal.aborted) throw new DOMException("", "AbortError");
  try {
    if (!succeeded(await sdk.startRTMS())) throw new Error("requestFailed");
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
