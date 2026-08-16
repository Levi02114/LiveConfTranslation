import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth";
import { publish } from "@/lib/realtime/hub";
import { releaseMeetingCaptures } from "@/lib/realtime/capture-lease";
import {
  closeMeeting,
  deleteClosedMeeting,
  getMeeting,
  getMeetingActivity,
  getMeetingLangs,
  getMeetingPages,
  getRecentMessages,
} from "@/lib/repo";
import { engineCoverage, listEngines, refreshEngineSupport } from "@/lib/translate";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;

  await refreshEngineSupport();

  const { id } = await params;
  const meeting = getMeeting(id);
  if (!meeting) {
    return Response.json({ error: "세션을 찾을 수 없습니다" }, { status: 404 });
  }

  const langs = getMeetingLangs(id);

  return Response.json({
    meeting,
    langs,
    pages: getMeetingPages(id),
    activity: getMeetingActivity(id),
    messages: getRecentMessages(id),
    // 어떤 엔진이 어떤 언어를 못 하는지 관리자가 미리 알 수 있게 함께 내려 준다.
    engines: listEngines().map((engine) => engineCoverage(engine.id, langs)),
  });
}

/** 회의 종료. 종료된 회의에는 더 이상 입력이 들어가지 않는다. */
export async function POST(_request: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const meeting = getMeeting(id);
  if (!meeting) {
    return Response.json({ error: "세션을 찾을 수 없습니다" }, { status: 404 });
  }

  if (meeting.status === "closed") {
    return Response.json({ meeting });
  }

  closeMeeting(id);
  releaseMeetingCaptures(id);
  revalidatePath("/admin");

  // 열려 있는 입력 페이지가 즉시 잠기도록 알린다.
  publish(id, { t: "meeting-closed", closedAt: Date.now() });

  return Response.json({ meeting: getMeeting(id) });
}

/** 종료된 세션과 하위 기록을 실제로 삭제한다. */
export async function DELETE(_request: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const meeting = getMeeting(id);
  if (!meeting) {
    return Response.json({ error: "세션을 찾을 수 없습니다" }, { status: 404 });
  }
  if (meeting.status !== "closed") {
    return Response.json({ error: "진행 중인 세션은 삭제할 수 없습니다" }, { status: 409 });
  }

  if (!deleteClosedMeeting(id)) {
    return Response.json({ error: "세션을 찾을 수 없습니다" }, { status: 404 });
  }
  revalidatePath("/admin");
  return Response.json({ deleted: true });
}
