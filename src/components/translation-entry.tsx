import type { UiStrings } from "@/lib/i18n-builtin";
import { type Language, textDirection } from "@/lib/languages";
import { formatClock } from "@/lib/log-format";
import type { CombinedEntry } from "@/lib/repo";

/** 원문 하나와 그 번역들을 통합 조회와 같은 가로 묶음으로 표시한다. */
export function TranslationEntry({
  entry,
  languages,
  targetLanguages = languages,
  strings,
  showSourceLanguage = false,
}: {
  entry: CombinedEntry;
  languages: Language[];
  targetLanguages?: Language[];
  strings: UiStrings;
  showSourceLanguage?: boolean;
}) {
  const source = languages.find((language) => language.code === entry.sourceLang);
  const targets = targetLanguages.filter((language) => language.code !== entry.sourceLang);

  return (
    <section className="border-b border-line py-5">
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
        <p
          lang={entry.sourceLang}
          dir={textDirection(entry.sourceLang)}
          className="app-text whitespace-pre-wrap [text-wrap:pretty]"
        >
          {entry.sourceBody}
        </p>
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
                  <p className="app-text whitespace-pre-wrap [text-wrap:pretty]">
                    {translation.body}
                  </p>
                ) : (
                  <p className="font-mono text-[12px] text-muted italic">
                    {strings.status.failed}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
