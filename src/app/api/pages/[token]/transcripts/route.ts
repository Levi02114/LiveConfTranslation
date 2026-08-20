import { z } from "zod";

import { acceptTranscript, translateMessage } from "@/lib/pipeline";
import { ownsCapture } from "@/lib/realtime/capture-lease";
import {
  getMeeting,
  getMeetingLanguageConfigs,
  getPageByToken,
  isPageEnabled,
} from "@/lib/repo";
import { cleanTranscript } from "@/lib/transcript-clean";

type Params = { params: Promise<{ token: string }> };

const schema = z.object({
  leaseId: z.string().uuid(),
  ingestKey: z.string().min(8).max(240),
  body: z.string().trim().min(1).max(5000),
  lang: z.string().trim().min(1).max(35).optional(),
  speakerName: z.string().trim().min(1).max(40).regex(/^[^\r\n]+$/).optional(),
});

export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  const page = getPageByToken(token);
  if (
    !page ||
    !page.lang ||
    !isPageEnabled(page) ||
    (page.kind !== "input" && page.kind !== "capture" && page.kind !== "combined-input")
  ) {
    return Response.json({ error: "음성 수집 페이지를 찾을 수 없습니다" }, { status: 404 });
  }

  const meeting = getMeeting(page.meetingId);
  if (!meeting || (page.kind === "capture" && meeting.inputMode !== "realtime")) {
    return Response.json({ error: "AI 전사 세션을 찾을 수 없습니다" }, { status: 404 });
  }
  if (meeting.status === "closed") {
    return Response.json({ error: "종료된 세션입니다" }, { status: 409 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "요청이 올바르지 않습니다" }, { status: 400 });
  if (meeting.speakerLabels && !parsed.data.speakerName) {
    return Response.json({ error: "닉네임을 입력해 주세요" }, { status: 400 });
  }
  if (!ownsCapture(page.id, parsed.data.leaseId)) {
    return Response.json({ error: "음성 수집 권한이 만료되었습니다" }, { status: 409 });
  }
  const detectedLang =
    page.kind === "combined-input" ? parsed.data.lang : page.lang;
  if (
    !detectedLang ||
    (page.kind === "combined-input" &&
      !getMeetingLanguageConfigs(meeting.id).some(
        (row) => row.lang === detectedLang && row.inputEnabled,
      ))
  ) {
    return Response.json({ error: "감지된 입력 언어가 올바르지 않습니다" }, { status: 400 });
  }

  const cleaned = cleanTranscript(parsed.data.body);
  if (!cleaned) {
    // 무음·잡음 구간의 환각 전사다. 저장하지 않지만 클라이언트 오류로도 취급하지 않는다.
    return Response.json({ dropped: true, inserted: false }, { status: 200 });
  }

  const result = acceptTranscript({
    meeting,
    pageId: page.id,
    lang: detectedLang,
    body: cleaned,
    ingestKey: parsed.data.ingestKey,
    speakerName: meeting.speakerLabels ? parsed.data.speakerName : null,
  });

  if (result.inserted) {
    void translateMessage({
      meeting,
      messageId: result.message.id,
      sourceLang: result.message.lang,
      body: result.message.body,
      speakerName: result.message.speakerName,
    }).catch((error) => console.error("[translate] AI 전사 번역 오류", error));
  }

  return Response.json({ message: result.message, inserted: result.inserted }, { status: result.inserted ? 201 : 200 });
}
