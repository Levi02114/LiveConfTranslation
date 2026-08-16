import { z } from "zod";

import { acceptTranscript, translateMessage } from "@/lib/pipeline";
import { ownsCapture } from "@/lib/realtime/capture-lease";
import { getMeeting, getPageByToken } from "@/lib/repo";

type Params = { params: Promise<{ token: string }> };

const schema = z.object({
  leaseId: z.string().uuid(),
  ingestKey: z.string().min(8).max(240),
  body: z.string().trim().min(1).max(5000),
});

export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  const page = getPageByToken(token);
  if (!page || page.kind !== "capture" || !page.lang) {
    return Response.json({ error: "음성 수집 페이지를 찾을 수 없습니다" }, { status: 404 });
  }

  const meeting = getMeeting(page.meetingId);
  if (!meeting || meeting.inputMode !== "realtime") {
    return Response.json({ error: "AI 전사 세션을 찾을 수 없습니다" }, { status: 404 });
  }
  if (meeting.status === "closed") {
    return Response.json({ error: "종료된 세션입니다" }, { status: 409 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "요청이 올바르지 않습니다" }, { status: 400 });
  if (!ownsCapture(page.id, parsed.data.leaseId)) {
    return Response.json({ error: "음성 수집 권한이 만료되었습니다" }, { status: 409 });
  }

  const result = acceptTranscript({
    meeting,
    pageId: page.id,
    lang: page.lang,
    body: parsed.data.body,
    ingestKey: parsed.data.ingestKey,
  });

  if (result.inserted) {
    void translateMessage({
      meeting,
      messageId: result.message.id,
      sourceLang: result.message.lang,
      body: result.message.body,
    }).catch((error: unknown) => console.error("[translate] AI 전사 번역 오류", error));
  }

  return Response.json({ message: result.message, inserted: result.inserted }, { status: result.inserted ? 201 : 200 });
}
