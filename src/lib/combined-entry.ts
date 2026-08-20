import type { CombinedEntry } from "@/lib/repo";

type SourceUpdate = {
  messageId: number;
  pageId: string | null;
  lang: string;
  body: string;
  speakerName: string | null;
  revision: number;
  editedAt: number | null;
  createdAt: number;
};

type TranslationUpdate = {
  messageId: number;
  lang: string;
  body: string;
  status: "ok" | "error";
  error?: string;
  revision: number;
  createdAt: number;
};

/** 같은 ID의 수정 이벤트는 제자리 교체하고 이전 revision 번역은 버린다. */
export function upsertSource(entries: CombinedEntry[], message: SourceUpdate): CombinedEntry[] {
  const index = entries.findIndex((entry) => entry.messageId === message.messageId);
  if (index < 0) {
    return [...entries, {
      messageId: message.messageId,
      sourceLang: message.lang,
      sourceBody: message.body,
      speakerName: message.speakerName,
      pageId: message.pageId,
      revision: message.revision,
      editedAt: message.editedAt,
      createdAt: message.createdAt,
      updatedAt: message.editedAt ?? message.createdAt,
      translations: [],
    }];
  }
  const current = entries[index]!;
  if (message.revision < current.revision) return entries;
  const next = entries.slice();
  next[index] = {
    ...current,
    sourceLang: message.lang,
    sourceBody: message.body,
    speakerName: message.speakerName,
    pageId: message.pageId,
    revision: message.revision,
    editedAt: message.editedAt,
    updatedAt: Math.max(current.updatedAt, message.editedAt ?? message.createdAt),
    translations: message.revision > current.revision ? [] : current.translations,
  };
  return next;
}

export function upsertTranslation(
  entries: CombinedEntry[],
  message: TranslationUpdate,
): CombinedEntry[] {
  return entries.map((entry) => {
    if (entry.messageId !== message.messageId || entry.revision !== message.revision) return entry;
    const translation = {
      lang: message.lang,
      body: message.body,
      status: message.status,
      error: message.error ?? null,
    };
    const existing = entry.translations.findIndex((row) => row.lang === message.lang);
    const translations = entry.translations.slice();
    if (existing < 0) translations.push(translation);
    else translations[existing] = translation;
    return { ...entry, translations, updatedAt: Math.max(entry.updatedAt, message.createdAt) };
  });
}
