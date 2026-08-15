import Link from "next/link";

/**
 * 진입점.
 *
 * 참석자와 입력자는 배포받은 URL 로 바로 들어오므로 이 화면을 볼 일이 거의 없다.
 * 관리자가 주소를 잊었을 때 찾아오는 곳이라 안내만 둔다.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 px-6">
      <div>
        <h1 className="text-xl font-semibold">실시간 회의 번역</h1>
        <p className="mt-2 text-sm text-muted">
          회의를 열고 참석자에게 나눠 줄 주소를 받으려면 관리자로 로그인하세요.
        </p>
      </div>

      <Link
        href="/admin"
        className="inline-flex w-fit items-center border border-fg px-4 py-2 text-sm font-medium
                   transition-colors hover:bg-fg hover:text-bg"
      >
        관리자 로그인
      </Link>

      <p className="text-xs text-muted">
        입력·참석 페이지는 관리자가 나눠 준 주소로 바로 들어가면 됩니다.
      </p>
    </main>
  );
}
