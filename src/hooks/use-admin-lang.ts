"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { ADMIN_LANG_COOKIE, ADMIN_LANG_MAX_AGE } from "@/lib/admin-lang";
import type { LanguageCode } from "@/lib/languages";

/**
 * 관리자 화면 표시 언어를 바꾼다.
 *
 * 쿠키에 적고 서버 컴포넌트를 다시 그리게 한다(`router.refresh()`). 문구가
 * 서버에서 만들어지므로 클라이언트가 사전 네 벌을 들고 있을 필요가 없다.
 *
 * `httpOnly` 가 아니다 — 브라우저가 직접 쓰는 표시 설정이라 서버만 만질 이유가 없다.
 * 인증과 무관한 값이므로 노출되어도 잃을 것이 없다.
 */
export function useSetAdminLang(): (next: LanguageCode) => void {
  const router = useRouter();

  return useCallback(
    (next: LanguageCode) => {
      document.cookie = `${ADMIN_LANG_COOKIE}=${next}; path=/; max-age=${ADMIN_LANG_MAX_AGE}; samesite=lax`;
      router.refresh();
    },
    [router],
  );
}
