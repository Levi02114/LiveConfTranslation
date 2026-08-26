import { cookies } from "next/headers";

import { ADMIN_LANG_COOKIE, toAdminLang } from "@/lib/admin-lang";
import { requireAdmin } from "@/lib/auth";
import { getAdminStrings, getStrings } from "@/lib/i18n";
import { isLanguageCode, type LanguageCode } from "@/lib/languages";
import { renderLogFile, selectMinutesLines } from "@/lib/log-format";
import { renderMeetingMinutesPdf } from "@/lib/meeting-minutes-pdf";
import { getLogLines, getMeeting, listLanguages } from "@/lib/repo";

type Params = { params: Promise<{ id: string }> };

/** 파일명에 쓸 수 없는 문자를 걷어 낸다. 회의 제목이 그대로 들어가기 때문. */
function safeFileName(title: string): string {
  return title.replace(/[^\p{L}\p{N}\-_ ]/gu, "").trim() || "meeting";
}

/**
 * 회의 로그 조회.
 *
 * `?lang=ko&lang=vi` 는 로그 조회 언어를 거르고, 다운로드의 `?translations=ko,vi` 는
 * 모든 원문을 보존한 채 해당 언어 번역만 남긴다.
 */
export async function GET(request: Request, { params }: Params) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const { id } = await params;
  const meeting = getMeeting(id);
  if (!meeting) {
    return Response.json({ error: "세션을 찾을 수 없습니다" }, { status: 404 });
  }

  const url = new URL(request.url);
  const requested = url.searchParams.getAll("lang").filter(isLanguageCode);
  const langs: LanguageCode[] | undefined = requested.length ? requested : undefined;
  const format = url.searchParams.get("format");
  const translations = url.searchParams.get("translations");
  const translationLanguages = translations === null
    ? null
    : translations.split(",").filter(isLanguageCode);
  const lines = translationLanguages === null
    ? getLogLines(id, langs)
    : selectMinutesLines(getLogLines(id), translationLanguages);

  if (format === "txt" || format === "pdf") {
    const suffix = translationLanguages === null
      ? langs ? `-${langs.join("-")}` : ""
      : translationLanguages.length ? `-${translationLanguages.join("-")}` : "-source";
    const registered = listLanguages().map((row) => row.code);
    const uiLang = toAdminLang((await cookies()).get(ADMIN_LANG_COOKIE)?.value, registered);
    const ui = getStrings(uiLang);

    if (format === "pdf") {
      const strings = getAdminStrings(uiLang);
      const fileName = `${safeFileName(meeting.title)}${suffix}.pdf`;
      const pdf = await renderMeetingMinutesPdf({
        meetingTitle: meeting.title,
        languageCodes: [...new Set(lines.map((line) => line.lang))],
        displayLanguage: uiLang,
        lines,
        labels: {
          minutesTitle: strings.log.minutesTitle,
          source: strings.dashboard.source,
          translation: strings.log.translation,
          generatedAt: strings.log.generatedAt,
          edited: ui.message.edited,
          empty: strings.log.empty,
        },
      });
      return new Response(new Uint8Array(pdf), {
        headers: {
          "content-type": "application/pdf",
          "content-length": String(pdf.byteLength),
          "content-disposition": `attachment; filename="minutes.pdf"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
          "cache-control": "no-store",
        },
      });
    }

    const fileName = `${safeFileName(meeting.title)}${suffix}.txt`;
    return new Response(renderLogFile(lines, ui.message.edited), {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        // 비ASCII 제목을 위해 RFC 5987 형식을 함께 준다.
        "content-disposition": `attachment; filename="log.txt"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "cache-control": "no-store",
      },
    });
  }

  return Response.json({ meeting, lines });
}
