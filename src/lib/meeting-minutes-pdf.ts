import { existsSync } from "node:fs";
import { join } from "node:path";

import PDFDocument from "pdfkit";

import { formatTimestamp, type LogLine } from "@/lib/log-format";
import type { LanguageCode } from "@/lib/languages";

type PdfLabels = {
  minutesTitle: string;
  source: string;
  translation: string;
  generatedAt: string;
  edited: string;
  empty: string;
};

type FontSource = { path: string; family?: string };
type ContainerRange = {
  startPage: number;
  startY: number;
  endPage: number;
  endY: number;
};

const WINDOWS_FONTS = "C:/Windows/Fonts";
const APP_ROOT = globalThis.__liveConfTranslationAppRoot ?? process.cwd();
const GENERIC_FONTS: readonly FontSource[] = [
  { path: `${WINDOWS_FONTS}/arial.ttf` },
  { path: "/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf" },
];
const SCRIPT_FONTS = new Map<string, readonly FontSource[]>([
  ["Kore", [
    { path: `${WINDOWS_FONTS}/malgun.ttf` },
    { path: "/usr/share/fonts/truetype/nanum/NanumGothic.ttf" },
  ]],
  ["Hans", [
    { path: `${WINDOWS_FONTS}/msyh.ttc`, family: "Microsoft YaHei" },
    { path: "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf" },
  ]],
  ["Hant", [
    { path: `${WINDOWS_FONTS}/msjh.ttc`, family: "Microsoft JhengHei" },
    { path: "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf" },
  ]],
  ["Jpan", [
    { path: `${WINDOWS_FONTS}/meiryo.ttc`, family: "Meiryo" },
    { path: "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf" },
  ]],
  ["Thai", [
    { path: `${WINDOWS_FONTS}/LeelawUI.ttf` },
    { path: "/usr/share/fonts/truetype/noto/NotoSansThai-Regular.ttf" },
  ]],
  ["Sinh", [
    { path: join(APP_ROOT, "public", "fonts", "NotoSansSinhala-Variable.ttf") },
    { path: `${WINDOWS_FONTS}/Nirmala.ttf` },
    { path: "/usr/share/fonts/truetype/noto/NotoSansSinhala-Regular.ttf" },
  ]],
  ["Arab", [
    { path: `${WINDOWS_FONTS}/arial.ttf` },
    { path: "/usr/share/fonts/truetype/noto/NotoSansArabic-Regular.ttf" },
  ]],
  ["Deva", [
    { path: `${WINDOWS_FONTS}/Nirmala.ttf` },
    { path: "/usr/share/fonts/truetype/noto/NotoSansDevanagari-Regular.ttf" },
  ]],
  ["Beng", [
    { path: `${WINDOWS_FONTS}/Nirmala.ttf` },
    { path: "/usr/share/fonts/truetype/noto/NotoSansBengali-Regular.ttf" },
  ]],
  ["Taml", [
    { path: `${WINDOWS_FONTS}/Nirmala.ttf` },
    { path: "/usr/share/fonts/truetype/noto/NotoSansTamil-Regular.ttf" },
  ]],
  ["Telu", [
    { path: `${WINDOWS_FONTS}/Nirmala.ttf` },
    { path: "/usr/share/fonts/truetype/noto/NotoSansTelugu-Regular.ttf" },
  ]],
  ["Mymr", [
    { path: `${WINDOWS_FONTS}/mmrtext.ttf` },
    { path: "/usr/share/fonts/truetype/noto/NotoSansMyanmar-Regular.ttf" },
  ]],
  ["Khmr", [
    { path: `${WINDOWS_FONTS}/LeelawUI.ttf` },
    { path: "/usr/share/fonts/truetype/noto/NotoSansKhmer-Regular.ttf" },
  ]],
  ["Hebr", [
    { path: `${WINDOWS_FONTS}/arial.ttf` },
    { path: "/usr/share/fonts/truetype/noto/NotoSansHebrew-Regular.ttf" },
  ]],
]);

function scriptOf(code: LanguageCode): string {
  try {
    return new Intl.Locale(code).maximize().script ?? "Latn";
  } catch {
    return "Latn";
  }
}

function fontFor(code: LanguageCode): FontSource {
  for (const font of SCRIPT_FONTS.get(scriptOf(code)) ?? GENERIC_FONTS) {
    if (existsSync(/* turbopackIgnore: true */ font.path)) return font;
  }
  for (const font of GENERIC_FONTS) {
    if (existsSync(/* turbopackIgnore: true */ font.path)) return font;
  }
  return {
    path: join(APP_ROOT, "node_modules", "@fontsource", "unifont", "files", "unifont-latin-400-normal.woff"),
  };
}

function fontForText(text: string, fallback: LanguageCode): FontSource {
  const scripts: ReadonlyArray<[RegExp, LanguageCode]> = [
    [/\p{Script=Hangul}/u, "ko"],
    [/\p{Script=Sinhala}/u, "si"],
    [/\p{Script=Thai}/u, "th"],
    [/\p{Script=Han}/u, "zh-CN"],
    [/\p{Script=Latin}/u, "en"],
  ];
  return fontFor(scripts.find(([pattern]) => pattern.test(text))?.[1] ?? fallback);
}

function setFont(document: PDFKit.PDFDocument, font: FontSource) {
  return font.family ? document.font(font.path, font.family) : document.font(font.path);
}

export function groupMeetingLogLines(lines: readonly LogLine[]): LogLine[][] {
  const groups = new Map<number, LogLine[]>();
  for (const line of lines) {
    const group = groups.get(line.messageId) ?? [];
    group.push(line);
    groups.set(line.messageId, group);
  }
  return [...groups.values()].map((group) => [
    ...group.filter((line) => line.kind === "source"),
    ...group.filter((line) => line.kind === "translation"),
  ]);
}

/** A4 회의록을 생성한다. 각 본문은 언어별 시스템 글꼴을 쓰고 없으면 내장 글꼴로 폴백한다. */
export async function renderMeetingMinutesPdf(input: {
  meetingTitle: string;
  languageCodes: readonly LanguageCode[];
  displayLanguage: LanguageCode;
  lines: readonly LogLine[];
  labels: PdfLabels;
  generatedAt?: number;
}): Promise<Buffer> {
  const document = new PDFDocument({
    size: "A4",
    margins: { top: 52, right: 56, bottom: 58, left: 56 },
    bufferPages: true,
    info: { Title: `${input.meetingTitle} · ${input.labels.minutesTitle}` },
  });
  const chunks: Buffer[] = [];
  const complete = new Promise<Buffer>((resolve, reject) => {
    document.on("data", (chunk: Buffer) => chunks.push(chunk));
    document.on("end", () => resolve(Buffer.concat(chunks)));
    document.on("error", reject);
  });
  const headerFont = fontFor(input.displayLanguage);
  const contentWidth = document.page.width - document.page.margins.left - document.page.margins.right;
  const cardX = document.page.margins.left;
  const cardPaddingX = 12;
  const cardPaddingY = 10;
  const cardWidth = contentWidth;
  const innerWidth = cardWidth - cardPaddingX * 2;
  const pageBottom = () => document.page.height - document.page.margins.bottom;
  const currentPage = () => {
    const range = document.bufferedPageRange();
    return range.start + range.count - 1;
  };
  const containers: ContainerRange[] = [];

  setFont(document, headerFont).fontSize(10).fillColor("#666666").text(input.labels.minutesTitle);
  document.moveDown(0.35);
  setFont(document, fontForText(input.meetingTitle, input.displayLanguage))
    .fontSize(22).fillColor("#111111").text(input.meetingTitle, {
    width: contentWidth,
    lineGap: 2,
  });
  setFont(document, headerFont).moveDown(0.55).fontSize(9).fillColor("#666666").text(
    `${input.languageCodes.join(" · ")}  /  ${input.labels.generatedAt}: ${formatTimestamp(input.generatedAt ?? Date.now())}`,
    { width: contentWidth },
  );
  document.moveDown(1).strokeColor("#D8D8D8")
    .moveTo(document.page.margins.left, document.y)
    .lineTo(document.page.width - document.page.margins.right, document.y)
    .stroke();

  if (input.lines.length === 0) {
    document.moveDown(1.4).fontSize(11).fillColor("#666666").text(input.labels.empty, {
      width: contentWidth,
    });
  }

  for (const group of groupMeetingLogLines(input.lines)) {
    let estimatedHeight = cardPaddingY * 2;
    for (const line of group) {
      const body = line.speakerName ? `${line.speakerName} — ${line.body}` : line.body;
      setFont(document, fontFor(line.lang)).fontSize(11.5);
      estimatedHeight += 30 + document.heightOfString(body, { width: innerWidth, lineGap: 3 })
        + (line.editedAt ? 13 : 0);
    }
    const maximumCardHeight = pageBottom() - document.page.margins.top;
    if (document.y + estimatedHeight + 12 > pageBottom() && estimatedHeight < maximumCardHeight) {
      document.addPage();
    }

    document.y += 12;
    const startPage = currentPage();
    const startY = document.y;
    document.y += cardPaddingY;

    group.forEach((line, index) => {
      if (index > 0) {
        document.y += 8;
        document.lineWidth(0.5).strokeColor("#DDDDDD")
          .moveTo(cardX + cardPaddingX, document.y)
          .lineTo(cardX + cardWidth - cardPaddingX, document.y)
          .stroke();
        document.y += 8;
      }
      const source = line.kind === "source";
      const bodyFont = fontFor(line.lang);
      setFont(document, headerFont).fontSize(8.5).fillColor("#777777").text(
        `${formatTimestamp(line.at)} · ${source ? input.labels.source : input.labels.translation} · ${line.lang}`,
        cardX + cardPaddingX,
        document.y,
        { width: innerWidth },
      );
      document.moveDown(0.35);
      document.lineWidth(source ? 0.2 : 0).strokeColor("#111111");
      if (line.speakerName) {
        setFont(document, fontForText(line.speakerName, line.lang)).fontSize(11.5).fillColor("#111111")
          .text(`${line.speakerName} — `, cardX + cardPaddingX, document.y, {
            width: innerWidth,
            lineGap: 3,
            continued: true,
            fill: true,
            stroke: source,
          });
      } else {
        document.x = cardX + cardPaddingX;
      }
      setFont(document, bodyFont).fontSize(11.5).fillColor("#111111").text(line.body, {
        width: innerWidth,
        lineGap: 3,
        fill: true,
        stroke: source,
      });
      if (line.editedAt) {
        document.moveDown(0.2);
        setFont(document, headerFont).fontSize(8).fillColor("#777777").text(`(${input.labels.edited})`, {
          width: innerWidth,
        });
      }
    });

    document.y = Math.min(document.y + cardPaddingY, pageBottom());
    containers.push({ startPage, startY, endPage: currentPage(), endY: document.y });
  }

  for (const container of containers) {
    for (let page = container.startPage; page <= container.endPage; page += 1) {
      document.switchToPage(page);
      const top = page === container.startPage ? container.startY : document.page.margins.top;
      const bottom = page === container.endPage ? container.endY : pageBottom();
      document.save().fillColor("#777777").fillOpacity(0.07)
        .roundedRect(cardX, top, cardWidth, Math.max(1, bottom - top), 5).fill()
        .restore();
      document.save().lineWidth(0.6).strokeColor("#D6D6D6").strokeOpacity(0.9)
        .roundedRect(cardX, top, cardWidth, Math.max(1, bottom - top), 5).stroke()
        .restore();
    }
  }

  const pages = document.bufferedPageRange();
  for (let index = pages.start; index < pages.start + pages.count; index += 1) {
    document.switchToPage(index);
    const bottomMargin = document.page.margins.bottom;
    document.page.margins.bottom = 0;
    setFont(document, headerFont).fontSize(8).fillColor("#888888").text(
      `${index - pages.start + 1} / ${pages.count}`,
      document.page.margins.left,
      document.page.height - 34,
      { width: contentWidth, align: "right", lineBreak: false },
    );
    document.page.margins.bottom = bottomMargin;
  }

  document.end();
  return complete;
}
