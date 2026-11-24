/**
 * 자동 음성 입력은 오디오 턴(최대 발화 시간·침묵) 단위로 끊기므로 문장 한가운데서 잘린 조각이
 * 그대로 메시지가 되고, 번역도 반쪽 문장으로 나간다. 전사 결과를 마지막 문장 끝까지만 내보내고
 * 남은 꼬리는 다음 턴 앞에 붙여 메시지를 문장 단위로 다시 묶는다.
 */

// 문장 끝 부호 뒤에 닫는 따옴표·괄호가 올 수 있고, 그다음은 공백이거나 글 끝이어야 한다(3.5 같은 소수 제외).
const SENTENCE_END = /[.!?。！？…؟।॥෴](?:["'”’»)\]」』]*)(?=\s|$)/gu;
const CLAUSE_END = /[,，、;；:：](?=\s|$)/gu;

export type JoinedSegment = { text: string; lang: string; key: string };

export type SentenceJoinerOptions = {
  /** 꼬리를 이보다 오래 들고 있지 않는다. */
  maxHoldMs?: number;
  /** 꼬리가 이보다 길면 쉼표에서라도 내보낸다. */
  maxHoldChars?: number;
};

function lastMatchEnd(pattern: RegExp, text: string): number {
  let end = -1;
  for (const match of text.matchAll(pattern)) end = match.index + match[0].length;
  return end;
}

export class SentenceJoiner {
  private held = "";
  private heldLang = "";
  private heldKey = "";
  private heldSince = 0;
  private readonly maxHoldMs: number;
  private readonly maxHoldChars: number;

  constructor(options: SentenceJoinerOptions = {}) {
    this.maxHoldMs = options.maxHoldMs ?? 25_000;
    this.maxHoldChars = options.maxHoldChars ?? 280;
  }

  holding(): boolean { return Boolean(this.held); }

  /** 아직 저장하지 않은 꼬리. 초안 자리에 보여 준다. */
  peek(): string { return this.held; }

  /**
   * 새 전사를 넣고 지금 저장할 조각을 돌려준다. `key` 는 재전송해도 같은 값이어야 하는 멱등 키다.
   * 꼬리를 나중에 내보낼 때는 그 꼬리를 만든 전사의 키에 `:tail` 을 붙인다.
   */
  /** `replaceLastWord` 는 서버가 겹침 재전사로 앞 꼬리의 마지막 단어를 잘린 단어로 판정했다는 뜻이다. */
  push(text: string, lang: string, key: string, now: number, replaceLastWord = false): JoinedSegment[] {
    const out: JoinedSegment[] = [];
    const body = text.trim();
    if (this.held && this.heldLang !== lang) {
      const flushed = this.flush();
      if (flushed) out.push(flushed);
    }
    if (!body) return out;
    // 아직 저장하지 않은 꼬리의 잘린 마지막 단어는 다음 전사의 온전한 단어로 바꾼다(겹침 재전사).
    if (replaceLastWord && this.held) {
      const lastSpace = this.held.lastIndexOf(" ");
      this.held = lastSpace > 0 ? this.held.slice(0, lastSpace).trim() : "";
    }
    const combined = this.held ? `${this.held} ${body}` : body;
    if (!this.held) this.heldSince = now;
    const end = lastMatchEnd(SENTENCE_END, combined);
    let emit = end > 0 ? combined.slice(0, end).trim() : "";
    let rest = end > 0 ? combined.slice(end).trim() : combined;
    if (rest && (now - this.heldSince >= this.maxHoldMs || rest.length > this.maxHoldChars)) {
      // 너무 오래 들고 있으면 쉼표까지라도 내보낸다. 쉼표도 없으면 통째로 내보낸다.
      const clause = lastMatchEnd(CLAUSE_END, rest);
      const cut = clause > 0 && clause >= rest.length / 3 ? clause : rest.length;
      emit = `${emit} ${rest.slice(0, cut)}`.trim();
      rest = rest.slice(cut).trim();
    }
    if (emit) out.push({ text: emit, lang, key });
    this.held = rest;
    this.heldLang = lang;
    this.heldKey = key;
    if (rest && emit) this.heldSince = now;
    return out;
  }

  /** 들고 있는 꼬리를 내보낸다(중지·연결 종료·말이 멈췄을 때). */
  flush(): JoinedSegment | null {
    if (!this.held) return null;
    const segment = { text: this.held, lang: this.heldLang, key: `${this.heldKey}:tail` };
    this.held = "";
    return segment;
  }
}
