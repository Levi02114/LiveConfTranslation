// 줄바꿈·탭과 문자 결합에 쓰이는 ZWJ/ZWNJ는 보존한다.
// oxlint-disable-next-line eslint/no-control-regex -- 제거 대상 자체가 제어문자 범위다.
const NON_SEMANTIC_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\uFEFF]/g;

/** 저장 전에 문자 표현만 정규화하며, 실제 단어·반복·내부 공백은 바꾸지 않는다. */
export function cleanTranscript(raw: string): string | null {
  const cleaned = raw.normalize("NFC").replace(NON_SEMANTIC_CONTROLS, "").trim();
  return cleaned || null;
}
