import type { UiStrings } from "@/lib/i18n-builtin";
import type { LanguageCode } from "@/lib/languages";
import { textDirection } from "@/lib/languages";

export type GuideCard = {
  href: string;
  lang: LanguageCode;
  label: string;
  ariaLabel: string;
};

/** 참가자·입력자 안내가 공유하는 무번들 저대역폭 HTML. */
export function renderGuidePage({
  displayLang,
  meetingTitle,
  roleTitle,
  options,
  cards,
  strings,
  cookie,
  maxAge,
}: {
  displayLang: LanguageCode;
  meetingTitle: string;
  roleTitle: string;
  options: { code: LanguageCode; nativeName: string }[];
  cards: GuideCard[];
  strings: UiStrings;
  cookie: string;
  maxAge: number;
}) {
  const languageOptions = options
    .map(({ code, nativeName }) =>
      `<option value="${html(code)}"${code === displayLang ? " selected" : ""}>${html(nativeName)}</option>`,
    )
    .join("");
  const links = cards
    .map(({ href, lang, label, ariaLabel }) =>
      `<a href="${html(href)}" lang="${html(lang)}" dir="${textDirection(lang)}" aria-label="${html(ariaLabel)}"><span>${html(label)}</span></a>`,
    )
    .join("");
  const data = json({
    cookie,
    maxAge,
    light: strings.appearance.light,
    dark: strings.appearance.dark,
  });

  return new Response(
    `<!doctype html>
<html lang="${html(displayLang)}" dir="${textDirection(displayLang)}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${html(meetingTitle)} · ${html(roleTitle)}</title>
<script>(function(){try{var r=document.documentElement,t=localStorage.getItem('lct.theme'),s=localStorage.getItem('lct.fontSize');if(t)r.dataset.theme=t;r.dataset.size=s||'md'}catch(e){}})()</script>
<style>${CSS}</style>
</head>
<body>
<nav><select id="language" title="${html(strings.appearance.language)}" aria-label="${html(strings.appearance.language)}">${languageOptions}</select><button id="theme" type="button" title="${html(strings.appearance.theme)}"></button><button id="smaller" type="button" aria-label="${html(strings.appearance.decrease)}">−</button><span id="size">100%</span><button id="larger" type="button" aria-label="${html(strings.appearance.increase)}">＋</button></nav>
<main><h1>${html(meetingTitle)}</h1><div class="languages">${links}</div></main>
<script>const DATA=${data};${CLIENT}</script>
</body></html>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "private, no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    },
  );
}

function html(value: string): string {
  return value.replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
      character
    ]!,
  );
}

function json<T>(value: T): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

const CSS = String.raw`
:root{--bg:#fff;--fg:#000;--muted:#7a7a7a;--line:#e4e4e4;font-size:100%;color-scheme:light}
:root[data-theme=dark]{--bg:#000;--fg:#fff;--muted:#8c8c8c;--line:#262626;color-scheme:dark}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#000;--fg:#fff;--muted:#8c8c8c;--line:#262626;color-scheme:dark}}
:root[data-size=sm]{font-size:80%}:root[data-size=lg]{font-size:125%}:root[data-size=xl]{font-size:150%}:root[data-size=xxl]{font-size:200%}
*{box-sizing:border-box}html,body{min-height:100%;margin:0}body{background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
button,select,#size{height:1.3rem}button,select{border:1px solid var(--line);background:var(--bg);color:inherit;padding:0 8px;font:inherit;cursor:pointer}button{display:inline-flex;align-items:center;justify-content:center}button:hover,a:hover{background:var(--fg);color:var(--bg)}
nav{position:fixed;z-index:2;top:max(10px,env(safe-area-inset-top));right:14px;display:flex;align-items:center;gap:8px;background:var(--bg);color:var(--muted);font:.6875rem ui-monospace,monospace}nav select{max-width:150px;color:var(--muted)}#theme{width:calc(5.75em + 18px);flex:none;font-size:clamp(10px,.5rem,16px)}#size{display:inline-flex;min-width:44px;align-items:center;justify-content:center}
main{width:min(100%,1040px);margin:auto;padding:6.75rem 32px 64px}h1{margin:0;padding-bottom:24px;border-bottom:1px solid var(--line);font-size:1.6875rem;font-weight:500;overflow-wrap:anywhere}.languages{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,14rem),1fr));gap:12px;margin-top:24px}.languages a{display:flex;min-width:0;min-height:5rem;align-items:center;border:1px solid var(--line);padding:18px 20px;color:inherit;text-decoration:none;transition:background-color .15s,color .15s}.languages span{min-width:0;font-size:1.25rem;line-height:1.35;overflow-wrap:anywhere;word-break:normal;hyphens:auto}
@media(max-width:640px){nav{left:12px;right:12px;display:grid;grid-template-columns:auto auto auto auto;justify-content:end}nav select{grid-column:1/-1;width:100%;max-width:none}main{padding:7.5rem 16px 48px}h1{padding-bottom:18px}.languages{grid-template-columns:1fr;margin-top:18px}.languages a{min-height:4.5rem;padding:15px 16px}}
`;

const CLIENT = String.raw`
const root=document.documentElement,language=document.getElementById('language'),theme=document.getElementById('theme'),size=document.getElementById('size'),sizes=['sm','md','lg','xl','xxl'],labels=['80%','100%','125%','150%','200%'];
language.onchange=()=>{document.cookie=DATA.cookie+'='+encodeURIComponent(language.value)+'; path=/; max-age='+DATA.maxAge+'; samesite=lax';location.reload()};
function applyTheme(){const dark=root.dataset.theme==='dark'||(!root.dataset.theme&&matchMedia('(prefers-color-scheme:dark)').matches);theme.textContent=dark?DATA.light:DATA.dark}theme.onclick=()=>{const dark=root.dataset.theme==='dark'||(!root.dataset.theme&&matchMedia('(prefers-color-scheme:dark)').matches);root.dataset.theme=dark?'light':'dark';try{localStorage.setItem('lct.theme',root.dataset.theme)}catch(e){}applyTheme()};
function applySize(next){root.dataset.size=next;size.textContent=labels[sizes.indexOf(next)];try{localStorage.setItem('lct.fontSize',next)}catch(e){}}document.getElementById('smaller').onclick=()=>applySize(sizes[Math.max(0,sizes.indexOf(root.dataset.size||'md')-1)]);document.getElementById('larger').onclick=()=>applySize(sizes[Math.min(sizes.length-1,sizes.indexOf(root.dataset.size||'md')+1)]);
applyTheme();size.textContent=labels[sizes.indexOf(root.dataset.size||'md')];
`;
