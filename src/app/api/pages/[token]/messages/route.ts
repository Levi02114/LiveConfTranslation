import { z } from "zod";

import { detectTextLanguage } from "@/lib/detect-text-language";
import {
  getMeeting,
  getMeetingLanguageConfigs,
  getPageByToken,
  isPageEnabled,
} from "@/lib/repo";
import { acceptMessage, translateMessage } from "@/lib/pipeline";

type Params = { params: Promise<{ token: string }> };

const schema = z.object({
  body: z.string().trim().min(1, "내용을 입력해 주세요").max(5000),
  speakerName: z.string().trim().min(1).max(40).regex(/^[^\r\n]+$/).optional(),
});

/**
 * 입력 페이지에서 친 문장을 받는다.
 *
 * 원문을 저장·배포한 즉시 응답하고, 번역은 **응답을 기다리지 않고** 이어서 돌린다.
 * 속기사는 계속 타이핑해야 하므로 번역 왕복(수백 ms)만큼 붙잡아 두지 않는다.
 * 번역 결과는 SSE 로 각 페이지에 따로 도착한다.
 *
 * 이 방식은 프로세스가 계속 살아 있는 자체 호스팅 환경을 전제한다.
 * 서버리스로 옮긴다면 응답 후 실행이 중단되므로 대기 큐가 필요해진다.
 */
export async function POST(request: Request, { params }: Params) {
  const { token } = await params;

  const page = getPageByToken(token);
  // 입력 페이지에만 언어가 있다. 통합 보기·출력 페이지로는 글을 보낼 수 없다.
  if (
    !page ||
    (page.kind !== "input" && page.kind !== "combined-input") ||
    !page.lang ||
    !isPageEnabled(page)
  ) {
    return Response.json({ error: "입력 페이지를 찾을 수 없습니다" }, { status: 404 });
  }
  const fallbackLang = page.lang;

  const meeting = getMeeting(page.meetingId);
  if (!meeting) {
    return Response.json({ error: "세션을 찾을 수 없습니다" }, { status: 404 });
  }

  if (meeting.status === "closed") {
    return Response.json({ error: "종료된 세션입니다" }, { status: 409 });
  }

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "요청이 올바르지 않습니다", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }
  if (meeting.speakerLabels && !parsed.data.speakerName) {
    return Response.json({ error: "닉네임을 입력해 주세요" }, { status: 400 });
  }

  const detected =
    page.kind === "combined-input"
      ? await detectTextLanguage(
          parsed.data.body,
          getMeetingLanguageConfigs(meeting.id)
            .filter((row) => row.inputEnabled)
            .map((row) => row.lang),
          fallbackLang,
        )
      : { lang: fallbackLang, usedFallback: false };

  const message = acceptMessage({
    meeting,
    pageId: page.id,
    lang: detected.lang,
    body: parsed.data.body,
    speakerName: meeting.speakerLabels ? parsed.data.speakerName : null,
  });

  void translateMessage({
    meeting,
    messageId: message.id,
    sourceLang: detected.lang,
    body: message.body,
    speakerName: message.speakerName,
  }).catch((error: unknown) => {
    // 개별 언어 실패는 파이프라인 안에서 이미 저장·배포된다.
    // 여기까지 올라온 건 예상 못 한 오류라 서버 로그에만 남긴다.
    console.error("[translate] 처리되지 않은 오류", error);
  });

  return Response.json({ message, usedFallback: detected.usedFallback }, { status: 201 });
}
