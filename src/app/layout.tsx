import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";

import { APPEARANCE_INIT_SCRIPT } from "@/lib/appearance";

import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "실시간 회의 번역",
  description: "회의 내용을 실시간으로 번역해 참석자 언어별로 전달합니다.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
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
