import { requireAdmin } from "@/lib/auth";
import { isLanguageCode, type LanguageCode } from "@/lib/languages";
import { renderLogFile } from "@/lib/log-format";
import { getLogLines, getMeeting } from "@/lib/repo";

type Params = { params: Promise<{ id: string }> };

/** 파일명에 쓸 수 없는 문자를 걷어 낸다. 회의 제목이 그대로 들어가기 때문. */
function safeFileName(title: string): string {
  return title.replace(/[^\p{L}\p{N}\-_ ]/gu, "").trim() || "meeting";
}

/**
 * 회의 로그 조회.
 *
 * `?lang=ko&lang=vi` 로 언어를 걸러 내고, `?format=txt` 면 화면에 뿌리는 대신
 * 파일로 내려받게 한다. **화면에서 보고 있는 필터 그대로** 받아야 하므로
 * 필터링과 파일 생성이 같은 코드 경로를 쓴다.
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

  const lines = getLogLines(id, langs);

  if (url.searchParams.get("format") === "txt") {
    const suffix = langs ? `-${langs.join("-")}` : "";
    const fileName = `${safeFileName(meeting.title)}${suffix}.txt`;

    return new Response(renderLogFile(lines), {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        // 비ASCII 제목을 위해 RFC 5987 형식을 함께 준다.
        "content-disposition": `attachment; filename="log.txt"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      },
    });
  }

  return Response.json({ meeting, lines });
}
