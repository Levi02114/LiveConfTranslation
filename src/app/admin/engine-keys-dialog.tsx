"use client";

import { useRef, useState } from "react";

import { formatTimestamp } from "@/lib/log-format";
import type { EngineId } from "@/lib/translate/types";

export type EngineKeyStatus = {
  engine: EngineId;
  configured: boolean;
  source: "db" | "env" | null;
  hint: string | null;
  updatedAt: number | null;
};

/**
 * 번역 엔진 API 키 등록.
 *
 * 서버는 **키를 절대 되돌려 주지 않는다**. 그래서 "지금 뭐가 들어 있는지"는
 * 마스킹된 힌트로만 보여 주고, 수정은 언제나 새로 덮어쓰기다.
 *
 * 별도 창이 아니라 모달로 연 이유: 키를 붙여넣는 화면이라 창을 오가지 않는 편이
 * 안전하고, 팝업 차단에도 걸리지 않는다.
 */
export function EngineKeysDialog({
  engines,
  initial,
  onChange,
}: {
  engines: { id: EngineId; label: string }[];
  initial: EngineKeyStatus[];
  /** 등록·삭제 결과를 부모에게 알린다 — 엔진 목록의 "(키 없음)" 표시가 따라가야 한다. */
  onChange?: (status: EngineKeyStatus) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [keys, setKeys] = useState<EngineKeyStatus[]>(initial);
  const [drafts, setDrafts] = useState<Partial<Record<EngineId, string>>>({});
  const [busy, setBusy] = useState<EngineId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const statusOf = (engine: EngineId) => keys.find((key) => key.engine === engine);

  const apply = (updated: EngineKeyStatus) => {
    setKeys((prev) => prev.map((key) => (key.engine === updated.engine ? updated : key)));
    onChange?.(updated);
  };

  const save = async (engine: EngineId) => {
    const key = (drafts[engine] ?? "").trim();
    if (!key || busy) return;

    setBusy(engine);
    setError(null);
    try {
      const response = await fetch("/api/admin/engine-keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ engine, key }),
      });
      const payload = (await response.json()) as { key?: EngineKeyStatus; error?: string };

      if (!response.ok || !payload.key) {
        setError(payload.error ?? "키를 저장하지 못했습니다");
        return;
      }
      apply(payload.key);
      // 저장한 값은 화면에 남기지 않는다.
      setDrafts((prev) => ({ ...prev, [engine]: "" }));
    } catch {
      setError("키를 저장하지 못했습니다");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (engine: EngineId) => {
    if (busy) return;

    setBusy(engine);
    setError(null);
    try {
      const response = await fetch(`/api/admin/engine-keys?engine=${engine}`, {
        method: "DELETE",
      });
      const payload = (await response.json()) as { key?: EngineKeyStatus; error?: string };

      if (!response.ok || !payload.key) {
        setError(payload.error ?? "키를 지우지 못했습니다");
        return;
      }
      apply(payload.key);
    } catch {
      setError("키를 지우지 못했습니다");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="cursor-pointer border border-line px-2.5 py-1.5 font-mono text-[12px] text-muted transition-colors hover:border-fg hover:bg-fg hover:text-bg"
      >
        API 키 등록
      </button>

      <dialog
        ref={dialogRef}
        onClose={() => {
          // 창을 닫으면 입력해 둔 값도 지운다. 화면에 키가 남아 있지 않게.
          setDrafts({});
          setError(null);
        }}
        className="m-auto w-[min(560px,calc(100vw-32px))] border border-line bg-bg p-0 text-fg backdrop:bg-black/45"
      >
        <div className="px-7 py-6">
          <div className="flex items-baseline justify-between gap-4">
            <div className="font-mono text-[12px] tracking-[0.04em] text-muted">
              번역 엔진 API 키
            </div>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              className="cursor-pointer font-mono text-[12px] text-muted hover:text-fg"
            >
              닫기
            </button>
          </div>

          <p className="mt-3 font-mono text-[11px] leading-[1.6] text-muted">
            키는 암호화해서 DB 에 저장되며 화면으로 다시 꺼내 볼 수 없습니다.
            등록한 키가 환경변수보다 우선합니다.
          </p>

          {error ? <div className="mt-3 font-mono text-[12px]">{error}</div> : null}

          <div className="mt-5 flex flex-col">
            {engines.map((engine) => {
              const status = statusOf(engine.id);
              return (
                <div key={engine.id} className="border-t border-line py-4">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[15px]">{engine.label}</span>
                    <span className="font-mono text-[11px] text-muted">
                      {status?.configured
                        ? `${status.hint} · ${status.source === "db" ? "등록됨" : "환경변수"}`
                        : "없음"}
                    </span>
                  </div>

                  {status?.source === "db" && status.updatedAt ? (
                    <div className="mt-1 font-mono text-[11px] text-muted">
                      {formatTimestamp(status.updatedAt)}
                    </div>
                  ) : null}

                  <div className="mt-2.5 flex items-end gap-3">
                    <input
                      type="password"
                      autoComplete="off"
                      value={drafts[engine.id] ?? ""}
                      onChange={(event) =>
                        setDrafts((prev) => ({ ...prev, [engine.id]: event.target.value }))
                      }
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void save(engine.id);
                        }
                      }}
                      placeholder={status?.configured ? "새 키로 덮어쓰기" : "API 키"}
                      className="min-w-0 flex-1 border-0 border-b border-line bg-transparent py-1.5 font-mono text-[13px] outline-none focus:border-fg"
                    />
                    <button
                      type="button"
                      onClick={() => void save(engine.id)}
                      disabled={busy !== null || !(drafts[engine.id] ?? "").trim()}
                      className="shrink-0 cursor-pointer border border-fg px-3.5 py-1.5 font-mono text-[12px] transition-colors hover:bg-fg hover:text-bg disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg"
                    >
                      {busy === engine.id ? "저장 중" : "저장"}
                    </button>
                    {status?.source === "db" ? (
                      <button
                        type="button"
                        onClick={() => void remove(engine.id)}
                        disabled={busy !== null}
                        className="shrink-0 cursor-pointer border border-line px-3 py-1.5 font-mono text-[12px] text-muted transition-colors hover:border-fg hover:bg-fg hover:text-bg disabled:cursor-default disabled:opacity-30"
                      >
                        삭제
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </dialog>
    </>
  );
}
