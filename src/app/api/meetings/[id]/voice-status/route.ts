import { requireAdmin } from "@/lib/auth";
import { listActiveCaptures, releaseParticipantCaptures } from "@/lib/realtime/capture-lease";
import { listInputParticipants, stopInputVoice } from "@/lib/realtime/hub";
import { getMeeting } from "@/lib/repo";
import { z } from "zod";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const meeting = getMeeting(id);
  if (!meeting) return Response.json({ error: "세션을 찾을 수 없습니다" }, { status: 404 });

  const activeIds = new Set(listActiveCaptures(id).map(({ participantId }) => participantId));
  return Response.json({
    participants: listInputParticipants(id).map((participant) => ({
      ...participant,
      microphoneOn: activeIds.has(participant.participantId),
    })),
  });
}

const stopSchema = z.object({ participantId: z.string().trim().min(8).max(100) });

export async function POST(request: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const meeting = getMeeting(id);
  if (!meeting) return Response.json({ error: "세션을 찾을 수 없습니다" }, { status: 404 });
  const parsed = stopSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "잘못된 요청입니다" }, { status: 400 });

  releaseParticipantCaptures(id, parsed.data.participantId);
  return Response.json({ stopped: stopInputVoice(id, parsed.data.participantId) });
}
