"use client";

import { memo, useState } from "react";

import type { UiStrings } from "@/lib/i18n-builtin";
import { type Language, textDirection } from "@/lib/languages";
import { formatClock } from "@/lib/log-format";
import type { CombinedEntry } from "@/lib/repo";
import { translationFailureText } from "@/lib/translation-failure";

/** 원문 하나와 그 번역들을 통합 조회와 같은 가로 묶음으로 표시한다. */
export const TranslationEntry = memo(function TranslationEntry({
  entry,
  languages,
  targetLanguages = languages,
  strings,
  showSourceLanguage = false,
  editable = false,
  onEdit,
}: {
  entry: CombinedEntry;
  languages: Language[];
  targetLanguages?: Language[];
  strings: UiStrings;
  showSourceLanguage?: boolean;
  editable?: boolean;
  onEdit?: (messageId: number, body: string, revision: number) => Promise<"ok" | "conflict" | "error">;
}) {
  const source = languages.find((language) => language.code === entry.sourceLang);
  const targets = targetLanguages.filter((language) => language.code !== entry.sourceLang);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(entry.sourceBody);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const save = async () => {
    const body = draft.trim();
    if (!body || saving || !onEdit) return;
    setSaving(true);
    setEditError(null);
    const result = await onEdit(entry.messageId, body, entry.revision);
    setSaving(false);
    if (result === "ok") {
      setEditing(false);
      return;
    }
    setEditError(result === "conflict" ? strings.message.editConflict : strings.message.editFailed);
  };

  return (
    <section className="border-b border-line py-5 [contain-intrinsic-size:auto_190px] [content-visibility:auto]">
      <div className="grid grid-cols-1 gap-1 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-[18px]">
        <div className="whitespace-nowrap font-mono text-[12px] text-muted">
          {entry.speakerName || showSourceLanguage ? (
            <div className="mb-1 text-[11px]">
              {entry.speakerName ? `(${entry.speakerName})` : null}
              {entry.speakerName && showSourceLanguage ? " " : null}
              {showSourceLanguage ? `(${source?.nativeName ?? entry.sourceLang})` : null}
            </div>
          ) : null}
          <time>{formatClock(entry.createdAt)}</time>
        </div>
        <div className="min-w-0">
          {editing ? (
            <>
              <textarea
                autoFocus
                aria-label={strings.message.edit}
                value={draft}
                maxLength={5000}
                rows={3}
                onChange={(event) => setDraft(event.target.value)}
                className="app-text min-h-24 w-full resize-y border border-line bg-bg px-3 py-2 text-fg outline-none focus:border-fg"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2 font-mono text-[11px]">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving || !draft.trim()}
                  className="cursor-pointer border border-fg px-3 py-1.5 hover:bg-fg hover:text-bg disabled:cursor-default disabled:opacity-30"
                >
                  {saving ? strings.message.saving : strings.message.save}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(entry.sourceBody);
                    setEditing(false);
                    setEditError(null);
                  }}
                  disabled={saving}
                  className="cursor-pointer border border-line px-3 py-1.5 text-muted hover:border-fg hover:text-fg disabled:cursor-default disabled:opacity-30"
                >
                  {strings.message.cancel}
                </button>
                {editError ? <span role="alert">{editError}</span> : null}
              </div>
            </>
          ) : (
            <>
              <p
                lang={entry.sourceLang}
                dir={textDirection(entry.sourceLang)}
                className="app-text whitespace-pre-wrap [text-wrap:pretty]"
              >
                {entry.sourceBody}
              </p>
              <div className="mt-1.5 flex items-center gap-3 font-mono text-[11px] text-muted">
                {entry.editedAt ? <span>({strings.message.edited})</span> : null}
                {editable ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(entry.sourceBody);
                      setEditError(null);
                      setEditing(true);
                    }}
                    className="cursor-pointer hover:text-fg"
                  >
                    {strings.message.edit}
                  </button>
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>

      {targets.length ? (
        <div className="mt-4 grid gap-x-6 gap-y-4 [grid-template-columns:repeat(auto-fit,minmax(240px,1fr))] sm:pl-[64px]">
          {targets.map((language) => {
            const translation = entry.translations.find(
              (row) => row.lang === language.code,
            );

            return (
              <div
                key={language.code}
                lang={language.code}
                dir={textDirection(language.code)}
                className="border-l border-line pl-4"
              >
                <div className="mb-1.5 font-mono text-[11px] text-muted">
                  {language.nativeName}
                </div>
                {!translation ? (
                  <p className="font-mono text-[12px] text-muted">{strings.status.waiting}</p>
                ) : translation.status === "ok" ? (
                  <div>
                    <p className="app-text whitespace-pre-wrap [text-wrap:pretty]">
                      {translation.body}
                    </p>
                    {entry.editedAt ? (
                      <span className="mt-1.5 block font-mono text-[11px] text-muted">
                        ({strings.message.edited})
                      </span>
                    ) : null}
                  </div>
                ) : (
                  <p className="font-mono text-[12px] text-muted italic">
                    {translationFailureText(translation.error, strings.status)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
});
