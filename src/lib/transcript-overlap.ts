/**
 * 최대 발화 시간으로 강제로 끊은 턴은 앞 턴 끝 1초를 다음 턴 앞에 겹쳐 다시 듣는다(잘린 단어 복구).
 * 겹친 구간은 두 전사에 모두 나오므로 다음 전사의 앞부분에서 걷어 낸다.
 */

/** 겹쳐 다시 보내는 음성 길이(24kHz mono s16le 1초). */
export const OVERLAP_PCM_BYTES = 24_000 * 2;

const MAX_WORDS = 8;
const MAX_CHARS = 40;
const MIN_CHARS = 4;

function normalize(word: string): string {
  return word.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]/gu, "");
}

export type OverlapResult = {
  text: string;
  /** 앞 전사의 마지막 단어가 강제 컷에 잘리거나 잘못 들린 단어라 `text` 의 첫 단어로 바꿔야 한다. */
  replaceLastWord: boolean;
};

/** `next` 앞부분 중 `prev` 끝과 겹치는 부분을 지운 결과. 겹침을 찾지 못하면 `next` 그대로. */
export function dropOverlap(prev: string, next: string): OverlapResult {
  const before = prev.trim().split(/\s+/).map(normalize).filter(Boolean);
  const words = next.trim().split(/\s+/).filter(Boolean);
  const after = words.map(normalize);
  if (!before.length || !words.length) return { text: next.trim(), replaceLastWord: false };
  for (let k = Math.min(MAX_WORDS, before.length, after.length); k >= 1; k--) {
    const tail = before.slice(-k);
    if (tail.every((word, index) => word === after[index]) && tail.join("").length >= 2) {
      return { text: words.slice(k).join(" "), replaceLastWord: false };
    }
    // 앞 턴 마지막 단어만 다르면 잘린 단어다(econo → economía, 실측: prestar → perder).
    // 그 앞 단어들이 겹친 증거가 되므로 잘린 단어는 다음 턴의 형태를 남긴다.
    const lead = tail.slice(0, -1);
    const cutPrefix = k >= 2 && after[k - 1].length > tail[k - 1].length && after[k - 1].startsWith(tail[k - 1]);
    if (lead.every((word, index) => word === after[index]) && (cutPrefix || (k >= 3 && lead.join("").length >= 4))) {
      return { text: words.slice(k - 1).join(" "), replaceLastWord: true };
    }
  }
  // 띄어쓰기가 없는 문자(태국어 등)는 글자 단위로 겹침을 찾는다.
  const a = prev.trim();
  const b = next.trim();
  for (let k = Math.min(MAX_CHARS, a.length, b.length); k >= MIN_CHARS; k--) {
    if (a.endsWith(b.slice(0, k))) return { text: b.slice(k).trim(), replaceLastWord: false };
  }
  return { text: b, replaceLastWord: false };
}
