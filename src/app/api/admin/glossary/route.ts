import { z } from "zod";

import { requireAdmin } from "@/lib/auth";
import type { LanguageCode } from "@/lib/languages";
import { listGlossaryEntries, listLanguages, replaceGlossaryEntries } from "@/lib/repo";

const termSchema = z.object({
  lang: z.string().trim().min(1).max(35),
  term: z.string().trim().min(1).max(500).regex(/^[^\t\r\n]+$/),
});

const saveSchema = z.object({
  entries: z
    .array(
      z.object({
        id: z.string().min(1).max(100).optional(),
        terms: z.array(termSchema).min(1).max(100),
      }),
    )
    .max(500),
});

export async function GET() {
  const denied = await requireAdmin();
  if (denied) return denied;
  return Response.json({ entries: listGlossaryEntries() });
}

export async function PUT(request: Request) {
  const denied = await requireAdmin();
  if (denied) return denied;

  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "요청이 올바르지 않습니다", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }

  const languages = listLanguages().map((row) => row.code);
  const expected = new Set(languages);
  const entries: { id?: string; terms: Record<LanguageCode, string> }[] = [];
  for (const entry of parsed.data.entries) {
    const terms = Object.fromEntries(entry.terms.map((item) => [item.lang, item.term])) as Record<
      LanguageCode,
      string
    >;
    if (
      entry.terms.length !== languages.length ||
      Object.keys(terms).some((lang) => !expected.has(lang)) ||
      languages.some((lang) => !terms[lang])
    ) {
      return Response.json({ error: "등록된 모든 언어의 단어가 필요합니다" }, { status: 400 });
    }
    entries.push({ id: entry.id, terms });
  }

  for (const lang of languages) {
    const seen = new Set<string>();
    for (const entry of entries) {
      const term = entry.terms[lang].normalize().toLocaleLowerCase();
      if (seen.has(term)) {
        return Response.json({ error: "같은 언어에 중복된 단어가 있습니다" }, { status: 409 });
      }
      seen.add(term);
    }
  }

  return Response.json({ entries: replaceGlossaryEntries(entries) });
}
