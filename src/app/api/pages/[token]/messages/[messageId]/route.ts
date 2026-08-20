import { z } from "zod";

import { publishMessage, translateMessage } from "@/lib/pipeline";
import { editMessage, getMeeting, getPageByToken, isPageEnabled } from "@/lib/repo";

type Params = { params: Promise<{ token: string; messageId: string }> };

const schema = z.object({
  body: z.string().trim().min(1).max(5000),
  revision: z.number().int().nonnegative(),
});

export async function PATCH(request: Request, { params }: Params) {
  const { token, messageId: rawMessageId } = await params;
  const messageId = Number(rawMessageId);
  const page = getPageByToken(token);
  if (
    !page ||
    !isPageEnabled(page) ||
    (page.kind !== "input" && page.kind !== "combined-input") ||
    !Number.isSafeInteger(messageId) ||
    messageId < 1
  ) {
    return Response.json({ error: "not-found" }, { status: 404 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid" }, { status: 400 });
  }

  const result = editMessage({
    pageId: page.id,
    messageId,
    body: parsed.data.body,
    revision: parsed.data.revision,
  });
  if (!result.ok) {
    return Response.json(
      { error: result.reason },
      { status: result.reason === "not-found" ? 404 : 409 },
    );
  }

  const meeting = getMeeting(page.meetingId);
  if (!meeting) return Response.json({ error: "not-found" }, { status: 404 });

  publishMessage(meeting.id, result.message);
  void translateMessage({
    meeting,
    messageId: result.message.id,
    sourceLang: result.message.lang,
    body: result.message.body,
    speakerName: result.message.speakerName,
    revision: result.message.revision,
    editedAt: result.message.editedAt,
    createdAt: result.message.createdAt,
  }).catch((error) => console.error("[translate] 수정 원문 번역 오류", error));

  return Response.json({ message: result.message });
}
