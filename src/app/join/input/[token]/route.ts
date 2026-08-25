import { cookies } from "next/headers";

import { ADMIN_LANG_COOKIE, ADMIN_LANG_MAX_AGE, toAdminLang } from "@/lib/admin-lang";
import { renderGuidePage } from "@/lib/guide-page";
import { getStrings } from "@/lib/i18n";
import { getLanguage } from "@/lib/languages";
import {
  getMeeting,
  getMeetingLanguageConfigs,
  getMeetingPages,
  getPageByToken,
  isPageEnabled,
  listLanguages,
} from "@/lib/repo";

type Params = { params: Promise<{ token: string }> };

/** 입력자가 자동 감지 또는 자기 입력 언어 페이지를 고르는 저대역폭 안내 화면. */
export async function GET(_request: Request, { params }: Params) {
  const { token } = await params;
  const guidePage = getPageByToken(token);
  if (!guidePage || guidePage.kind !== "combined" || !isPageEnabled(guidePage)) {
    return new Response("Not Found", { status: 404 });
  }

  const meeting = getMeeting(guidePage.meetingId);
  if (!meeting) return new Response("Not Found", { status: 404 });

  const registered = listLanguages().map((row) => row.code);
  const displayLang = toAdminLang((await cookies()).get(ADMIN_LANG_COOKIE)?.value, registered);
  const strings = getStrings(displayLang);
  const pages = getMeetingPages(meeting.id).filter(isPageEnabled);
  const inputPages = new Map(
    pages
      .filter((page) => page.kind === "input" && page.lang)
      .map((page) => [page.lang!, page]),
  );
  const combinedInput = pages.find((page) => page.kind === "combined-input");
  const cards = [
    ...(combinedInput
      ? [{
          href: `/in/all/${combinedInput.token}`,
          lang: displayLang,
          label: strings.input.autoLanguage,
          ariaLabel: `${strings.role.combinedInput}: ${strings.input.autoLanguage}`,
        }]
      : []),
    ...getMeetingLanguageConfigs(meeting.id)
      .filter((row) => row.inputEnabled)
      .flatMap((row) => {
        const page = inputPages.get(row.lang);
        if (!page) return [];
        const language = getLanguage(row.lang, displayLang);
        return [{
          href: `/in/${page.token}`,
          lang: row.lang,
          label: language.nativeName,
          ariaLabel: `${strings.role.input}: ${language.nativeName}`,
        }];
      }),
  ];
  if (!cards.length) return new Response("Not Found", { status: 404 });

  return renderGuidePage({
    displayLang,
    meetingTitle: meeting.title,
    roleTitle: strings.role.input,
    options: registered.map((code) => ({
      code,
      nativeName: getLanguage(code, displayLang).nativeName,
    })),
    cards,
    strings,
    cookie: ADMIN_LANG_COOKIE,
    maxAge: ADMIN_LANG_MAX_AGE,
  });
}
