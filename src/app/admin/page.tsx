import { redirect } from "next/navigation";

import { isAdmin } from "@/lib/auth";
import { defaultEngine } from "@/lib/env";
import { DEFAULT_LANGUAGES, LANGUAGES } from "@/lib/languages";
import { getMeetingLangs, listMeetings } from "@/lib/repo";
import { isEngineId, listEngines } from "@/lib/translate";

import { MeetingList } from "./meeting-list";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!(await isAdmin())) redirect("/admin/login");

  const meetings = listMeetings().map((meeting) => ({
    ...meeting,
    langs: getMeetingLangs(meeting.id),
  }));

  const configured = defaultEngine();

  return (
    <MeetingList
      meetings={meetings}
      languages={[...LANGUAGES]}
      defaultLangs={[...DEFAULT_LANGUAGES]}
      engines={listEngines().map((engine) => ({
        id: engine.id,
        label: engine.label,
        configured: engine.isConfigured(),
      }))}
      defaultEngine={isEngineId(configured) ? configured : "google"}
    />
  );
}
