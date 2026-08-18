import { cookies } from "next/headers";

import { ADMIN_LANG_COOKIE, ADMIN_LANG_MAX_AGE, toAdminLang } from "@/lib/admin-lang";
import { getStrings } from "@/lib/i18n";
import { getLanguage, textDirection } from "@/lib/languages";
import {
  getMeeting,
  getMeetingLanguageConfigs,
  getMeetingPages,
  getPageByToken,
  listLanguages,
} from "@/lib/repo";

type Params = { params: Promise<{ token: string }> };

/** 일반 참석자가 자기 언어의 출력 페이지를 고르는 저대역폭 안내 화면. */
export async function GET(_request: Request, { params }: Params) {
  const { token } = await params;
  const guidePage = getPageByToken(token);
  if (!guidePage || guidePage.kind !== "combined") {
    return new Response("Not Found", { status: 404 });
  }

  const meeting = getMeeting(guidePage.meetingId);
  if (!meeting) return new Response("Not Found", { status: 404 });

  const registered = listLanguages().map((row) => row.code);
  const displayLang = toAdminLang(
    (await cookies()).get(ADMIN_LANG_COOKIE)?.value,
    registered,
  );
  const strings = getStrings(displayLang);
  const outputPages = new Map(
    getMeetingPages(meeting.id)
      .filter((page) => page.kind === "output" && page.lang)
      .map((page) => [page.lang!, page]),
  );
  const outputLanguages = getMeetingLanguageConfigs(meeting.id)
    .filter((row) => row.outputEnabled)
    .map((row) => row.lang);
  if (outputLanguages.length === 0) return new Response("Not Found", { status: 404 });
  const cards = outputLanguages
    .map((code) => {
      const page = outputPages.get(code);
      if (!page) return "";
      const language = getLanguage(code, displayLang);
      return `<a href="/out/${html(page.token)}" lang="${html(code)}" dir="${textDirection(code)}" aria-label="${html(`${strings.role.output}: ${language.nativeName}`)}"><span>${html(language.nativeName)}</span></a>`;
    })
    .join("");
  const options = registered
    .map((code) => {
      const language = getLanguage(code, displayLang);
      return `<option value="${html(code)}"${code === displayLang ? " selected" : ""}>${html(language.nativeName)}</option>`;
    })
    .join("");
  const data = json({
    cookie: ADMIN_LANG_COOKIE,
    maxAge: ADMIN_LANG_MAX_AGE,
    light: strings.appearance.light,
    dark: strings.appearance.dark,
  });

  return new Response(
    `<!doctype html>
<html lang="${html(displayLang)}" dir="${textDirection(displayLang)}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${html(meeting.title)} · ${html(strings.role.output)}</title>
<script>(function(){try{var r=document.documentElement,t=localStorage.getItem('lct.theme'),s=localStorage.getItem('lct.fontSize');if(t)r.dataset.theme=t;r.dataset.size=s||'md'}catch(e){}})()</script>
<style>${CSS}</style>
</head>
<body>
<nav><select id="language" title="${html(strings.appearance.language)}" aria-label="${html(strings.appearance.language)}">${options}</select><button id="theme" type="button" title="${html(strings.appearance.theme)}"></button><button id="smaller" type="button" aria-label="${html(strings.appearance.decrease)}">−</button><span id="size">100%</span><button id="larger" type="button" aria-label="${html(strings.appearance.increase)}">＋</button></nav>
<main><h1>${html(meeting.title)}</h1><div class="languages">${cards}</div></main>
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

function json(value: unknown): string {
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
