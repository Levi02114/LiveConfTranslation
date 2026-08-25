import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import { encryptSecret, maskSecret } from "@/lib/crypto";
import { openaiAdminBaseUrl } from "@/lib/env";
import {
  aggregateOpenaiUsage,
  usagePeriodConfig,
  usagePeriodSchema,
} from "@/lib/openai-usage";
import { deleteEngineSecret, upsertEngineSecret } from "@/lib/repo";
import { openaiAdminKey, openaiAdminKeyStatus } from "@/lib/secrets";

const SECRET_ID = "openai-admin" as const;
const saveSchema = z.object({ key: z.string().trim().min(1).max(500) });

export async function GET(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const rawPeriod = new URL(request.url).searchParams.get("period");
  if (!rawPeriod) return Response.json({ status: openaiAdminKeyStatus() });

  const parsedPeriod = usagePeriodSchema.safeParse(rawPeriod);
  if (!parsedPeriod.success) {
    return Response.json({ error: "invalid-period" }, { status: 400 });
  }

  const key = openaiAdminKey();
  if (!key) {
    return Response.json(
      { status: openaiAdminKeyStatus(), error: "key-required" },
      { status: 412 },
    );
  }

  const period = parsedPeriod.data;
  const config = usagePeriodConfig[period];
  const endTime = Math.floor(Date.now() / 1000);
  const startTime = endTime - config.seconds;
  const url = new URL(`${openaiAdminBaseUrl()}/organization/usage/completions`);
  url.searchParams.set("start_time", String(startTime));
  url.searchParams.set("end_time", String(endTime));
  url.searchParams.set("bucket_width", config.bucketWidth);
  url.searchParams.set("limit", String(config.limit));
  url.searchParams.set("group_by", "model");

  try {
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${key}` },
      cache: "no-store",
    });
    if (!response.ok) {
      const error = response.status === 401
        ? "key-invalid"
        : response.status === 403
          ? "permission-denied"
          : response.status === 429
            ? "rate-limited"
            : "load-failed";
      return Response.json({ status: openaiAdminKeyStatus(), error }, { status: response.status });
    }

    const rows = aggregateOpenaiUsage(await response.json());
    return Response.json({
      status: openaiAdminKeyStatus(),
      period,
      startTime,
      endTime,
      rows,
    });
  } catch {
    return Response.json(
      { status: openaiAdminKeyStatus(), error: "load-failed" },
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid-key" }, { status: 400 });

  upsertEngineSecret({
    engine: SECRET_ID,
    secret: encryptSecret(parsed.data.key),
    hint: maskSecret(parsed.data.key),
  });
  return Response.json({ status: openaiAdminKeyStatus() });
}

export async function DELETE() {
  const denied = await requireAdmin();
  if (denied) return denied;

  deleteEngineSecret(SECRET_ID);
  return Response.json({ status: openaiAdminKeyStatus() });
}
