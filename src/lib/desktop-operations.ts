import { getAdminStrings } from "./i18n-resolver";
import { getLanguage } from "./languages";
import { connectionCounts } from "./realtime/hub";
import type { SessionConnections } from "./realtime/protocol";
import { getMeeting, getMeetingLangs, getMeetingPages, isPageEnabled, listMeetings } from "./repo";

type ConnectionsSnapshot = { sessions: SessionConnections[]; removed: string[] };

export function sessionConnections(ids?: string[]): ConnectionsSnapshot {
  const meetings = ids ? ids.map(getMeeting) : listMeetings();
  return {
    sessions: meetings.flatMap((meeting) => meeting ? [{
      meetingId: meeting.id,
      status: meeting.status,
      ...connectionCounts(meeting.id, getMeetingLangs(meeting.id)),
    }] : []),
    removed: ids?.filter((_, index) => !meetings[index]) ?? [],
  };
}

/** Only the Electron process owning this server can call this; no HTTP endpoint. */
export function desktopOperations(locale: string) {
  const strings = getAdminStrings(locale);
  return {
    strings: strings.operations,
    siteManagement: strings.security.siteManagement,
    at: Date.now(),
    sessions: listMeetings().filter((meeting) => meeting.status === "open").map((meeting) => ({
      id: meeting.id,
      title: meeting.title,
      counts: connectionCounts(meeting.id, getMeetingLangs(meeting.id)),
      languages: getMeetingLangs(meeting.id).map((lang) => getLanguage(lang, locale)),
      pages: getMeetingPages(meeting.id).filter(isPageEnabled).map((page) => ({
        kind: page.kind,
        lang: page.lang,
        path: `${page.kind === "combined" ? "/all" : page.kind === "combined-input" ? "/in/all" : page.kind === "input" ? "/in" : page.kind === "output" ? "/out" : "/capture"}/${page.token}`,
        token: page.kind === "combined" ? page.token : undefined,
      })),
    })),
  };
}

declare global {
  var __liveConfDesktopOperations: typeof desktopOperations | undefined;
}
