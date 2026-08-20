declare namespace Intl {
  interface Locale {
    getTextInfo?(): { direction?: string };
    readonly textInfo?: { direction?: string };
  }
}
