import { getStrings } from "@/lib/i18n";
import { getLanguage } from "@/lib/languages";
import {
  getMeeting,
  getMeetingActivity,
  getMeetingLangs,
  getPageByToken,
  getRecentCombined,
  getRecentTranslations,
} from "@/lib/repo";

type Params = { params: Promise<{ token: string }> };

/**
 * 입력·출력·통합 페이지가 처음 뜰 때 필요한 것을 한 번에 내려 준다.
 *
 * 토큰 자체가 접근 권한이다(로그인이 없다). 대신 토큰이 추측 불가능해야 하고
 * (`lib/ids.ts`), 회의가 끝나면 입력을 막는다.
 *
 * UI 문구를 여기서 함께 내려 주는 이유: 페이지 언어가 서버에만 있으므로,
 * 클라이언트가 사전 4벌을 모두 받아 놓고 고르게 하는 것보다 필요한 한 벌만
 * 보내는 편이 낫다.
 */
export async function GET(_request: Request, { params }: Params) {
  const { token } = await params;

  const page = getPageByToken(token);
  if (!page) {
    return Response.json({ error: "페이지를 찾을 수 없습니다" }, { status: 404 });
  }

  const meeting = getMeeting(page.meetingId);
  if (!meeting) {
    return Response.json({ error: "회의를 찾을 수 없습니다" }, { status: 404 });
  }

  const langs = getMeetingLangs(meeting.id);

  // 통합 보기는 특정 언어에 속하지 않는다. 운영자가 보는 화면이라 한국어로 낸다.
  const uiLang = page.lang ?? "ko";

  return Response.json({
    page: { kind: page.kind, lang: page.lang, token: page.token },
    language: page.lang ? getLanguage(page.lang) : null,
    strings: getStrings(uiLang),
    meeting: {
      id: meeting.id,
      title: meeting.title,
      status: meeting.status,
      langs,
      // 통합 보기가 언어별 이름을 자기 언어 표기로 보여 줄 수 있도록 함께 준다.
      languages: langs.map(getLanguage),
    },
    activity: getMeetingActivity(meeting.id),
    // 회의 중간에 들어와도 앞의 흐름을 볼 수 있어야 한다. 입력 페이지는 필요 없다.
    history:
      page.kind === "output" && page.lang
        ? getRecentTranslations(meeting.id, page.lang)
        : page.kind === "combined"
          ? getRecentCombined(meeting.id)
          : [],
  });
}
