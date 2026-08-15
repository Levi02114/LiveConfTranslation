import { notFound, redirect } from "next/navigation";

import { isAdmin } from "@/lib/auth";
import { getLanguage } from "@/lib/languages";
import {
  getMeeting,
  getMeetingLangs,
  getMeetingPages,
  getRecentCombined,
} from "@/lib/repo";
import { engineCoverage } from "@/lib/translate";

import { DashboardView } from "./dashboard-view";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  if (!(await isAdmin())) redirect("/admin/login");

  const { id } = await params;
  const meeting = getMeeting(id);
  if (!meeting) notFound();

  const langs = getMeetingLangs(id);

  return (
    <DashboardView
      meeting={meeting}
      languages={langs.map(getLanguage)}
      pages={getMeetingPages(id)}
      history={getRecentCombined(id, 40)}
      coverage={engineCoverage(meeting.engine, langs)}
    />
  );
}
