import type { Metadata } from "next";
import {
  Noto_Sans,
  Noto_Sans_KR,
  Noto_Sans_Mono,
  Noto_Sans_Sinhala,
  Noto_Sans_Thai,
} from "next/font/google";

import { APPEARANCE_INIT_SCRIPT } from "@/lib/appearance";

import "./globals.css";

/*
 * 지원 언어 네 개를 모두 그리려면 Noto 계열이 필요하다.
 * 태국어·싱할라어 글리프가 없는 글꼴을 쓰면 그 두 출력 페이지만
 * OS 기본 대체 글꼴로 떨어져 크기·굵기가 따로 논다.
 *
 * next/font 는 빌드 때 받아 자체 호스팅한다. 인터넷이 없는 로컬 네트워크에
 * 띄우는 게 전제라 구글 폰트 CDN <link> 를 쓰면 안 된다.
 */
const sans = Noto_Sans({
  variable: "--font-noto-sans",
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "700"],
});
const sansKr = Noto_Sans_KR({
  variable: "--font-noto-kr",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});
const sansThai = Noto_Sans_Thai({
  variable: "--font-noto-thai",
  subsets: ["latin", "thai"],
  weight: ["400", "500", "700"],
});
const sansSinhala = Noto_Sans_Sinhala({
  variable: "--font-noto-sinhala",
  subsets: ["latin", "sinhala"],
  weight: ["400", "500", "700"],
});
const mono = Noto_Sans_Mono({
  variable: "--font-noto-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const FONT_VARIABLES = [sans, sansKr, sansThai, sansSinhala, mono]
  .map((font) => font.variable)
  .join(" ");

export const metadata: Metadata = {
  title: "실시간 세션 번역",
  description: "세션 내용을 실시간으로 번역해 참석자 언어별로 전달합니다.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className={`${FONT_VARIABLES} h-full`}>
      <head>
        {/*
          React 가 붙기 전에 테마를 <html> 에 찍어 첫 페인트 깜빡임을 막는다.
          내용이 상수(APPEARANCE_INIT_SCRIPT)라 사용자 입력이 섞이지 않는다.
        */}
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full antialiased">{children}</body>
    </html>
  );
}
