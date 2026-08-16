/**
 * 서비스가 다루는 언어.
 *
 * **언어 목록은 런타임 데이터다.** 어떤 언어를 쓸지는 관리자가 화면에서 정하고
 * `languages` 테이블에 남는다(`lib/repo.ts`). 이 파일은 "코드 하나가 주어졌을 때
 * 사람이 읽을 이름을 어떻게 만드는가"만 책임진다.
 *
 * 이름을 저장하지 않고 `Intl.DisplayNames` 로 파생하는 이유: 언어를 추가할 때마다
 * 이름 세 벌(표시용·원어·영어)을 사람이 적어 넣어야 한다면 추가 기능이 의미가 없다.
 * Node 가 full ICU 로 빌드되어 있어 130여 개 언어의 이름을 이미 알고 있다.
 */

/**
 * 언어 코드. BCP-47 을 그대로 쓴다(`ko`, `zh-CN`, `pt-BR`).
 *
 * 유니온이 아니라 `string` 인 이유는 값이 DB 에서 오기 때문이다. 컴파일 타임에
 * 아는 집합이 아니므로 타입으로 좁힐 수 없다. **유효성은 타입이 아니라
 * `isLanguageCode()`(형식)와 DB 조회(등록 여부)로 지킨다.**
 */
export type LanguageCode = string;

export type Language = {
  code: LanguageCode;
  /** 관리자 화면 표시 언어로 쓴 이름 */
  label: string;
  /** 해당 언어 사용자에게 보여줄 이름. 입력/출력 페이지 헤더에 쓴다. */
  nativeName: string;
  /** 회의 로그에 남기는 영어 표기 */
  logName: string;
};

/**
 * 코드로 박혀 있는 기본 언어.
 *
 * 이 넷은 `lib/i18n-builtin.ts` 에 손으로 검수한 UI 문구가 있고, 삭제할 수 없다.
 * DB 의 `languages` 테이블에도 같은 값이 심긴다 — 목록을 읽는 곳은 언제나 DB 다.
 */
export const BUILTIN_LANGUAGES: readonly LanguageCode[] = ["ko", "vi", "th", "si"];

/** 회의를 새로 만들 때 기본으로 채워지는 언어 세트 */
export const DEFAULT_LANGUAGES: readonly LanguageCode[] = BUILTIN_LANGUAGES;

export function isBuiltinLanguage(code: LanguageCode): boolean {
  return BUILTIN_LANGUAGES.includes(code);
}

/**
 * BCP-47 **형식** 검사.
 *
 * "이 코드가 등록된 언어인가"는 여기서 답할 수 없다 — 그건 DB 를 봐야 한다.
 * 이 함수는 사용자 입력이 언어 코드 모양인지만 본다. 이 파일은 클라이언트에서도
 * 불릴 수 있어야 하므로 DB 를 건드리지 않는다.
 */
export function isLanguageCode(value: unknown): value is LanguageCode {
  return typeof value === "string" && /^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(value);
}

/*
 * Intl.DisplayNames 인스턴스는 만드는 비용이 있어 로케일별로 재사용한다.
 * 언어 하나를 그릴 때마다 세 개(표시용·원어·영어)를 만들면 목록 130줄에서 티가 난다.
 */
const displayNamesCache = new Map<string, Intl.DisplayNames | null>();

function displayNamesFor(locale: string): Intl.DisplayNames | null {
  const cached = displayNamesCache.get(locale);
  if (cached !== undefined) return cached;

  let instance: Intl.DisplayNames | null = null;
  try {
    // 두 번째 로케일로 "en" 을 두어, ICU 가 모르는 로케일일 때 시스템 기본 언어가
    // 아니라 영어로 떨어지게 한다. 서버 로케일에 따라 결과가 달라지면 안 된다.
    instance = new Intl.DisplayNames(locale === "en" ? ["en"] : [locale, "en"], {
      type: "language",
      fallback: "code",
    });
  } catch {
    instance = null;
  }

  displayNamesCache.set(locale, instance);
  return instance;
}

/**
 * `code` 를 `inLocale` 언어로 쓴 이름. 모르는 코드면 코드를 그대로 돌려준다.
 *
 * `fallback: "code"` 를 준 덕분에 `of()` 가 `undefined` 를 내지 않지만, 형식이
 * 아예 잘못된 값에는 여전히 던진다. 임의 문자열이 들어올 수 있으므로 감싼다.
 */
function displayName(code: LanguageCode, inLocale: string): string {
  const names = displayNamesFor(inLocale);
  if (!names) return code;
  try {
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * 언어 하나의 표시 정보.
 *
 * **던지지 않는다.** 예전에는 모르는 코드에 던졌는데, 언어가 런타임 데이터가 된
 * 지금은 DB 에 남아 있는 코드를 ICU 가 모를 수 있다. 회의 로그 한 줄 때문에
 * 페이지 전체가 500 이 되면 안 된다.
 *
 * @param displayLang `label` 을 어느 언어로 쓸지. 관리자 화면의 표시 언어.
 */
export function getLanguage(code: LanguageCode, displayLang: LanguageCode = "ko"): Language {
  return {
    code,
    label: displayName(code, displayLang),
    nativeName: displayName(code, code),
    logName: displayName(code, "en"),
  };
}

/** 회의 로그의 `(Translated: ...)` 에 들어가는 영어 표기 */
export function languageLogName(code: LanguageCode): string {
  return displayName(code, "en");
}

/**
 * 글이 흐르는 방향.
 *
 * 아랍어·히브리어처럼 오른쪽에서 왼쪽으로 쓰는 언어의 출력 페이지에 `dir="rtl"`
 * 을 걸어 주지 않으면 문장 부호와 숫자 위치가 무너진다.
 */
export function textDirection(code: LanguageCode): "ltr" | "rtl" {
  try {
    /*
     * getTextInfo() 는 TypeScript 의 Intl.Locale 타입에 아직 없다. 런타임(Node 22,
     * 최신 브라우저)에는 있으므로 좁은 형태로만 단언한다. 초안 단계에 이름이
     * `textInfo` 속성이었던 런타임도 있어 둘 다 본다.
     */
    const locale = new Intl.Locale(code) as Intl.Locale & {
      getTextInfo?: () => { direction?: string };
      textInfo?: { direction?: string };
    };
    const info = typeof locale.getTextInfo === "function" ? locale.getTextInfo() : locale.textInfo;
    return info?.direction === "rtl" ? "rtl" : "ltr";
  } catch {
    return "ltr";
  }
}
