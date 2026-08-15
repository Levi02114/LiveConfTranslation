"use client";

import { useCallback, useState, useSyncExternalStore } from "react";

import { AppearanceControls } from "@/components/appearance-controls";
import { useRealtime } from "@/hooks/use-realtime";
import { getStrings } from "@/lib/i18n";
import type { Language, LanguageCode } from "@/lib/languages";
import { formatClock, formatTimestamp } from "@/lib/log-format";
import type { ServerMessage } from "@/lib/realtime/protocol";
import type { CombinedEntry, Meeting, Page } from "@/lib/repo";

const strings = getStrings("ko");

/** 실시간 흐름에 남겨 둘 줄 수. 대시보드는 기록이 아니라 감시용이다. */
const FLOW_LIMIT = 60;

const subscribeNever = () => () => {};
const getOrigin = () => window.location.origin;
const getServerOrigin = () => "";

type Flow = {
  key: string;
  at: number;
  route: string;
  body: string;
  status: "원문" | "완료" | "실패";
};

export function DashboardView({
  meeting,
  languages,
  pages,
  history,
  coverage,
}: {
  meeting: Meeting;
  languages: Language[];
  pages: Page[];
  history: CombinedEntry[];
  coverage: { engine: string; label: string; configured: boolean; unsupported: LanguageCode[] };
}) {
  const [closed, setClosed] = useState(meeting.status === "closed");
  const [closedAt, setClosedAt] = useState<number | null>(meeting.closedAt);
  const [flows, setFlows] = useState<Flow[]>(() => seedFlows(history, languages));
  const [copied, setCopied] = useState<string | null>(null);

  // 참석자에게 나눠 줄 URL 은 절대 주소여야 한다. 서버는 접속자가 어느 주소로
  // 들어왔는지 모르므로(로컬 IP·호스트명 제각각) 브라우저에서 읽는다.
  // 값이 바뀌지 않으므로 구독은 비워 두고 스냅숏만 읽는다.
  const origin = useSyncExternalStore(subscribeNever, getOrigin, getServerOrigin);

  const nameOf = useCallback(
    (code: LanguageCode) =>
      languages.find((language) => language.code === code)?.label ?? code,
    [languages],
  );

  const onMessage = useCallback(
    (message: ServerMessage) => {
      if (message.t === "message") {
        setFlows((prev) =>
          push(prev, {
            key: `m${message.messageId}`,
            at: message.createdAt,
            route: nameOf(message.lang),
            body: message.body,
            status: "원문",
          }),
        );
      } else if (message.t === "translation") {
        setFlows((prev) =>
          push(prev, {
            key: `t${message.messageId}-${message.lang}`,
            at: message.createdAt,
            route: `→ ${nameOf(message.lang)}`,
            body: message.status === "ok" ? message.body : (message.error ?? "번역 실패"),
            status: message.status === "ok" ? "완료" : "실패",
          }),
        );
      } else if (message.t === "meeting-closed") {
        setClosed(true);
        setClosedAt(message.closedAt);
      }
    },
    [nameOf],
  );

  useRealtime(`meeting=${encodeURIComponent(meeting.id)}`, onMessage);

  const close = async () => {
    const response = await fetch(`/api/meetings/${meeting.id}`, { method: "POST" });
    if (response.ok) {
      setClosed(true);
      setClosedAt(Date.now());
    }
  };

  const copy = async (key: string, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(key);
      setTimeout(() => setCopied((current) => (current === key ? null : current)), 1200);
    } catch {
      // 클립보드가 막힌 브라우저에서는 주소를 직접 긁어 가면 된다.
    }
  };

  const openLog = () => {
    window.open(
      `/admin/meetings/${meeting.id}/log`,
      `log-${meeting.id}`,
      "width=820,height=760,noopener",
    );
  };

  const inputPages = new Map(
    pages.filter((page) => page.kind === "input" && page.lang).map((page) => [page.lang, page]),
  );
  const outputPages = new Map(
    pages.filter((page) => page.kind === "output" && page.lang).map((page) => [page.lang, page]),
  );
  const combined = pages.find((page) => page.kind === "combined");

  const copyBtn =
    "shrink-0 cursor-pointer border border-line px-2 py-1 font-mono text-[11px] text-muted transition-colors hover:bg-fg hover:text-bg";

  return (
    <div className="mx-auto max-w-[980px] px-8 pt-20 pb-16">
      <AppearanceControls strings={strings.appearance} />

      <div className="flex items-baseline justify-between gap-5">
        <div>
          <div className="text-[26px] font-medium">{meeting.title}</div>
          <div className="mt-1.5 font-mono text-[12px] text-muted">
            {languages.map((language) => language.label).join(" · ")} · {coverage.label}
            {coverage.configured ? "" : " (키 없음)"}
          </div>
        </div>
        {closed ? (
          <div className="shrink-0 font-mono text-[12px] text-muted">종료됨</div>
        ) : (
          <button
            type="button"
            onClick={() => void close()}
            className="shrink-0 cursor-pointer border border-line px-4 py-2 font-mono text-[13px] transition-colors hover:border-fg hover:bg-fg hover:text-bg"
          >
            회의 종료
          </button>
        )}
      </div>

      {closed ? (
        <div className="mt-4 border border-line px-4 py-3 font-mono text-[13px] text-muted">
          회의가 종료되었습니다
          {closedAt ? ` · ${formatTimestamp(closedAt)}` : ""}
        </div>
      ) : null}

      {coverage.unsupported.length ? (
        <div className="mt-4 border border-line px-4 py-3 font-mono text-[12px] text-muted">
          {coverage.label} 은(는) {coverage.unsupported.map(nameOf).join(" · ")} 을(를) 지원하지
          않습니다 — 해당 언어만 Google 로 번역됩니다
        </div>
      ) : null}

      <section className="mt-10">
        <div className="mb-1 font-mono text-[11px] text-muted">페이지 URL — 참석자에게 배포</div>
        <div className="grid grid-cols-[110px_1fr_1fr] gap-x-5 gap-y-3 border-b border-line py-3 font-mono text-[11px] text-muted">
          <div>언어</div>
          <div>입력 (속기사)</div>
          <div>출력 (참석자)</div>
        </div>

        {languages.map((language) => {
          const input = inputPages.get(language.code);
          const output = outputPages.get(language.code);
          return (
            <div
              key={language.code}
              className="grid grid-cols-[110px_1fr_1fr] items-center gap-x-5 gap-y-3 border-b border-line py-3.5"
            >
              <div className="text-[15px]">{language.label}</div>
              <UrlCell
                url={input ? `${origin}/in/${input.token}` : ""}
                copied={copied === `in-${language.code}`}
                onCopy={(url) => void copy(`in-${language.code}`, url)}
                className={copyBtn}
              />
              <UrlCell
                url={output ? `${origin}/out/${output.token}` : ""}
                copied={copied === `out-${language.code}`}
                onCopy={(url) => void copy(`out-${language.code}`, url)}
                className={copyBtn}
              />
            </div>
          );
        })}

        {combined ? (
          <div className="grid grid-cols-[110px_1fr] items-center gap-x-5 border-b border-line py-3.5">
            <div className="text-[15px]">통합 보기</div>
            <UrlCell
              url={`${origin}/all/${combined.token}`}
              copied={copied === "all"}
              onCopy={(url) => void copy("all", url)}
              className={copyBtn}
            />
          </div>
        ) : null}
      </section>

      <section className="mt-12">
        <div className="mb-1 font-mono text-[11px] text-muted">실시간 흐름</div>
        {flows.length === 0 ? (
          <p className="py-4 font-mono text-[12px] text-muted">아직 입력이 없습니다</p>
        ) : null}
        {flows.map((flow) => (
          <div
            key={flow.key}
            className="grid grid-cols-[50px_86px_1fr_56px] items-baseline gap-3.5 border-t border-line py-2.5"
          >
            <div className="font-mono text-[12px] text-muted">{formatClock(flow.at)}</div>
            <div className="truncate font-mono text-[12px]">{flow.route}</div>
            <div className="app-text [text-wrap:pretty]">{flow.body}</div>
            <div
              className={`font-mono text-[11px] ${flow.status === "실패" ? "text-fg" : "text-muted"}`}
            >
              {flow.status}
            </div>
          </div>
        ))}
      </section>

      <div className="mt-10 flex items-center gap-3">
        <button
          type="button"
          onClick={openLog}
          className="cursor-pointer border border-line px-4 py-2.5 font-mono text-[13px] transition-colors hover:border-fg hover:bg-fg hover:text-bg"
        >
          로그 보기 →
        </button>
        <span className="font-mono text-[11px] text-muted">새 팝업 창</span>
      </div>
    </div>
  );
}

function UrlCell({
  url,
  copied,
  onCopy,
  className,
}: {
  url: string;
  copied: boolean;
  onCopy: (url: string) => void;
  className: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="truncate font-mono text-[12px] text-muted">{url || "—"}</span>
      <button type="button" disabled={!url} onClick={() => onCopy(url)} className={className}>
        {copied ? "복사됨" : "복사"}
      </button>
    </div>
  );
}

function push(prev: Flow[], next: Flow): Flow[] {
  if (prev.some((flow) => flow.key === next.key)) return prev;
  return [...prev, next].slice(-FLOW_LIMIT);
}

/** 대시보드를 늦게 열어도 직전 흐름이 보이도록 지난 기록을 같은 모양으로 편다. */
function seedFlows(history: CombinedEntry[], languages: Language[]): Flow[] {
  const nameOf = (code: LanguageCode) =>
    languages.find((language) => language.code === code)?.label ?? code;

  const flows: Flow[] = [];
  for (const entry of history) {
    flows.push({
      key: `m${entry.messageId}`,
      at: entry.createdAt,
      route: nameOf(entry.sourceLang),
      body: entry.sourceBody,
      status: "원문",
    });
    for (const translation of entry.translations) {
      flows.push({
        key: `t${entry.messageId}-${translation.lang}`,
        at: entry.createdAt,
        route: `→ ${nameOf(translation.lang)}`,
        body: translation.status === "ok" ? translation.body : (translation.error ?? "번역 실패"),
        status: translation.status === "ok" ? "완료" : "실패",
      });
    }
  }
  return flows.slice(-FLOW_LIMIT);
}
