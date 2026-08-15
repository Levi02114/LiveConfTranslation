"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AppearanceControls } from "@/components/appearance-controls";
import { getStrings } from "@/lib/i18n";

/** 관리자 화면은 운영자 전용이라 문구를 한국어로 고정한다. */
const strings = getStrings("ko");

export function LoginForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async () => {
    if (!password || pending) return;

    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });

      if (!response.ok) {
        setError("비밀번호가 올바르지 않습니다");
        setPassword("");
        return;
      }

      // 서버 컴포넌트가 새 쿠키로 다시 그려지도록 갱신한 뒤 넘어간다.
      router.refresh();
      router.replace("/admin");
    } catch {
      setError("로그인에 실패했습니다");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <AppearanceControls strings={strings.appearance} textSize={false} />

      <div className="w-full max-w-[340px]">
        <div className="mb-7 font-mono text-[12px] tracking-[0.04em] text-muted">
          관리자 로그인
        </div>

        <input
          type="password"
          value={password}
          autoFocus
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void submit();
          }}
          placeholder="비밀번호"
          className="w-full border-0 border-b border-line bg-transparent py-2 text-[22px] outline-none focus:border-fg"
        />

        {error ? <div className="mt-3 font-mono text-[12px]">{error}</div> : null}

        <button
          type="button"
          onClick={() => void submit()}
          disabled={pending || !password}
          className="mt-8 w-full cursor-pointer border border-fg py-3 font-mono text-[14px] transition-colors hover:bg-fg hover:text-bg disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-fg"
        >
          {pending ? "확인 중" : "로그인"}
        </button>
      </div>
    </div>
  );
}
