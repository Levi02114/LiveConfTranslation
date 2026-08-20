import { cookies } from "next/headers";

import { ADMIN_LANG_COOKIE, ADMIN_LANG_MAX_AGE, toAdminLang } from "@/lib/admin-lang";
import { getStrings } from "@/lib/i18n";
import type { UiStrings } from "@/lib/i18n-builtin";
import { getLanguage, textDirection, type Language } from "@/lib/languages";
import { formatClock } from "@/lib/log-format";
import {
  getMeeting,
  getMeetingActiveLangs,
  getPageByToken,
  getRecentCombined,
  listLanguages,
  type CombinedEntry,
} from "@/lib/repo";

type Params = { params: Promise<{ token: string }> };

/** 통합 조회도 참석자 회선에서 쓰므로 React·웹폰트 없이 완결된 HTML로 보낸다. */
export async function GET(request: Request, { params }: Params) {
  const { token } = await params;
  const page = getPageByToken(token);
  if (!page || page.kind !== "combined") return new Response("Not Found", { status: 404 });

  const meeting = getMeeting(page.meetingId);
  if (!meeting) return new Response("Not Found", { status: 404 });

  const registered = listLanguages().map((row) => row.code);
  const lang = toAdminLang((await cookies()).get(ADMIN_LANG_COOKIE)?.value, registered);
  const strings = getStrings(lang);
  const languages = getMeetingActiveLangs(meeting.id).map((code) => getLanguage(code, lang));
  const snapshotAt = Date.now();
  const history = getRecentCombined(meeting.id);
  const sinceParam = new URL(request.url).searchParams.get("since");
  const since = Number(sinceParam);
  if (sinceParam !== null && Number.isSafeInteger(since) && since >= 0) {
    return Response.json(
      {
        entries: history.filter((entry) => entry.updatedAt >= since).map(compact),
        closed: meeting.status === "closed",
        snapshotAt,
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  }

  const data = json({
    token,
    snapshotAt,
    closed: meeting.status === "closed",
    languageCookie: ADMIN_LANG_COOKIE,
    languageCookieAge: ADMIN_LANG_MAX_AGE,
    languages: languages.map((item) => [item.code, item.nativeName, textDirection(item.code)]),
    strings: {
      connected: strings.connection.connected,
      reconnecting: strings.connection.reconnecting,
      disconnected: strings.connection.disconnected,
      closed: strings.meeting.closed,
      failed: strings.status.failed,
      waiting: strings.status.waiting,
      noContent: strings.status.noContent,
      newMessages: strings.status.newMessages,
      edited: strings.message.edited,
      light: strings.appearance.light,
      dark: strings.appearance.dark,
      theme: strings.appearance.theme,
      decrease: strings.appearance.decrease,
      increase: strings.appearance.increase,
    },
  });
  const options = registered
    .map((code) => {
      const language = getLanguage(code, lang);
      return `<option value="${html(code)}"${code === lang ? " selected" : ""}>${html(language.nativeName)}</option>`;
    })
    .join("");
  const entries = history.map((entry) => renderEntry(entry, languages, strings)).join("");
  const closed = meeting.status === "closed" ? ` · ${strings.meeting.closed}` : "";

  return new Response(
    `<!doctype html>
<html lang="${html(lang)}" dir="${textDirection(lang)}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${html(meeting.title)} · ${html(strings.role.combined)}</title>
<script>(function(){try{var r=document.documentElement,t=localStorage.getItem('lct.theme'),s=localStorage.getItem('lct.fontSize');if(t)r.dataset.theme=t;r.dataset.size=s||'md'}catch(e){}})()</script>
<style>${CSS}</style>
</head>
<body>
<nav><select id="language" title="${html(strings.appearance.language)}" aria-label="${html(strings.appearance.language)}">${options}</select><button id="theme" type="button" title="${html(strings.appearance.theme)}"></button><button id="smaller" type="button" aria-label="${html(strings.appearance.decrease)}">−</button><span id="size">md</span><button id="larger" type="button" aria-label="${html(strings.appearance.increase)}">＋</button></nav>
<main id="scroll"><div class="wrap">
<header><h1>${html(meeting.title)}</h1><div>${html(strings.role.combined)} · <span id="connection">${html(strings.connection.reconnecting)}</span><span id="closed">${html(closed)}</span></div></header>
<div id="entries" aria-live="polite">${entries}</div><p id="empty"${history.length ? " hidden" : ""}>${html(strings.status.noContent)}</p><div class="spacer" aria-hidden="true"></div>
</div></main>
<button id="latest" type="button" hidden>↓ ${html(strings.status.newMessages)} <span>0</span></button>
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

function compact(entry: CombinedEntry) {
  return [
    entry.messageId,
    entry.sourceLang,
    entry.sourceBody,
    entry.speakerName,
    entry.createdAt,
    entry.revision,
    entry.editedAt,
    entry.updatedAt,
    entry.translations.map((row) => [row.lang, row.body, row.status]),
  ];
}

function renderEntry(entry: CombinedEntry, languages: Language[], strings: UiStrings): string {
  const translations = new Map(entry.translations.map((row) => [row.lang, row]));
  const targets = languages
    .filter((language) => language.code !== entry.sourceLang)
    .map((language) => {
      const translation = translations.get(language.code);
      const status = !translation ? "waiting" : translation.status;
      const body = !translation
        ? strings.status.waiting
        : translation.status === "ok"
          ? translation.body
          : strings.status.failed;
      const edited = entry.editedAt ? `<small class="edited">(${html(strings.message.edited)})</small>` : "";
      return `<div class="translation" data-lang="${html(language.code)}" lang="${html(language.code)}" dir="${textDirection(language.code)}"><div class="label">${html(language.nativeName)}</div><p class="${status}">${html(body)}${translation?.status === "ok" ? edited : ""}</p></div>`;
    })
    .join("");

  const edited = entry.editedAt ? `<small class="edited">(${html(strings.message.edited)})</small>` : "";
  return `<section class="entry" data-id="${entry.messageId}" data-revision="${entry.revision}"><div class="source"><time>${formatClock(entry.createdAt)}</time><p lang="${html(entry.sourceLang)}" dir="${textDirection(entry.sourceLang)}">${html(`${entry.speakerName ? `(${entry.speakerName}) ` : ""}${entry.sourceBody}`)}${edited}</p></div>${targets ? `<div class="translations">${targets}</div>` : ""}</section>`;
}

function html(value: string): string {
  return value.replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!,
  );
}

function json<T>(value: T): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) =>
    `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

const CSS = String.raw`
:root{--bg:#fff;--fg:#000;--muted:#7a7a7a;--line:#e4e4e4;--text:1.375rem;font-size:100%;color-scheme:light}
:root[data-theme=dark]{--bg:#000;--fg:#fff;--muted:#8c8c8c;--line:#262626;color-scheme:dark}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#000;--fg:#fff;--muted:#8c8c8c;--line:#262626;color-scheme:dark}}
:root[data-size=sm]{font-size:80%}:root[data-size=lg]{font-size:125%}:root[data-size=xl]{font-size:150%}:root[data-size=xxl]{font-size:200%}
*{box-sizing:border-box}html,body{height:100%;margin:0}body{overflow:hidden;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,"Segoe UI",sans-serif}button,select,#size{height:1.3rem}button,select{border:1px solid var(--line);background:var(--bg);color:inherit;padding:0 8px;font:inherit;cursor:pointer}button{display:inline-flex;align-items:center;justify-content:center}button:hover{background:var(--fg);color:var(--bg)}
nav{position:fixed;z-index:2;top:10px;right:14px;display:flex;align-items:center;gap:8px;background:var(--bg);color:var(--muted);font:.6875rem ui-monospace,monospace}nav select{max-width:150px;color:var(--muted)}#theme{width:calc(5.75em + 18px);flex:none;font-size:clamp(10px,.5rem,16px)}#size{display:inline-flex;min-width:44px;align-items:center;justify-content:center}
main{height:100%;overflow-y:auto;padding:0 32px}.wrap{display:flex;min-height:100%;max-width:1400px;margin:auto;flex-direction:column;padding-top:3.375rem}header{flex:none;border-bottom:1px solid var(--line);padding-bottom:20px}h1{margin:0 0 6px;font-size:1.6875rem;font-weight:500}header div,#empty,.label{color:var(--muted);font:.75rem ui-monospace,monospace}#entries{flex:none;margin-top:auto}
.entry{border-bottom:1px solid var(--line);padding:20px 0;content-visibility:auto;contain-intrinsic-size:0 190px}.source{display:grid;grid-template-columns:auto minmax(0,1fr);gap:18px}.source time{white-space:nowrap;padding-top:.35em;color:var(--muted);font:.75rem ui-monospace,monospace}.source p,.translation p{min-width:0;margin:0;white-space:pre-wrap;text-wrap:pretty;font-size:var(--text);line-height:1.5}.translations{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px 24px;margin-top:16px;padding-left:64px}.translation{border-inline-start:1px solid var(--line);padding-inline-start:16px}.label{margin-bottom:6px;font-size:.6875rem}.translation .waiting,.translation .error{color:var(--muted);font:.75rem ui-monospace,monospace}.translation .error{font-style:italic}#empty{padding-top:24px}.spacer{height:80px}
.edited{display:block;margin-top:.35rem;color:var(--muted);font:.6875rem ui-monospace,monospace}
#latest{position:fixed;bottom:max(28px,env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);border-color:var(--fg);font-size:.8125rem}[hidden]{display:none!important}
@media(max-width:640px){nav{left:12px;right:12px;justify-content:flex-end}nav select{min-width:0;flex:1}main{padding:0 16px}.wrap{padding-top:3.375rem}.source{grid-template-columns:1fr;gap:2px}.source time{padding-top:0}.translations{grid-template-columns:1fr;padding-left:0}.spacer{height:56px}}
`;

const CLIENT = String.raw`
const root=document.documentElement,scroll=document.getElementById('scroll'),entriesNode=document.getElementById('entries'),empty=document.getElementById('empty'),connection=document.getElementById('connection'),closed=document.getElementById('closed'),latest=document.getElementById('latest'),theme=document.getElementById('theme'),size=document.getElementById('size'),language=document.getElementById('language');
const entries=new Map(),sizes=['sm','md','lg','xl','xxl'],labels=['80%','100%','125%','150%','200%'];let stick=true,pending=0,retry=0,timer,ended=DATA.closed,watermark=DATA.snapshotAt;document.querySelectorAll('.entry').forEach(row=>entries.set(Number(row.dataset.id),row));
function clock(at){const d=new Date(at),p=n=>String(n).padStart(2,'0');return p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds())}function lang(code){return DATA.languages.find(item=>item[0]===code)}function follow(){scroll.scrollTop=scroll.scrollHeight}function followSoon(){requestAnimationFrame(()=>requestAnimationFrame(follow))}function refollow(){stick=true;pending=0;latest.hidden=true;followSoon()}
function mark(body,edited){body.querySelector('.edited')?.remove();if(edited){const note=document.createElement('small');note.className='edited';note.textContent='('+DATA.strings.edited+')';body.append(note)}}
function resetTranslations(row){for(const body of row.querySelectorAll('.translation p')){body.className='waiting';body.textContent=DATA.strings.waiting}}
function addSource(message){let row=entries.get(message.messageId),fresh=!row;if(row&&message.revision<Number(row.dataset.revision||0))return row;empty.hidden=true;if(!row){row=document.createElement('section');row.className='entry';row.dataset.id=message.messageId;const source=document.createElement('div');source.className='source';source.append(document.createElement('time'),document.createElement('p'));row.append(source);const targets=DATA.languages.filter(item=>item[0]!==message.lang);if(targets.length){const grid=document.createElement('div');grid.className='translations';for(const item of targets){const target=document.createElement('div');target.className='translation';target.dataset.lang=item[0];target.lang=item[0];target.dir=item[2];const label=document.createElement('div');label.className='label';label.textContent=item[1];const text=document.createElement('p');text.className='waiting';text.textContent=DATA.strings.waiting;target.append(label,text);grid.append(target)}row.append(grid)}entriesNode.append(row);entries.set(message.messageId,row)}const previous=Number(row.dataset.revision||0);row.dataset.revision=message.revision;const source=row.querySelector('.source'),time=source.querySelector('time'),body=source.querySelector('p');time.textContent=clock(message.createdAt);body.lang=message.lang;body.dir=(lang(message.lang)||[])[2]||'ltr';body.textContent=(message.speakerName?'('+message.speakerName+') ':'')+message.body;mark(body,message.editedAt);if(message.revision>previous)resetTranslations(row);if(stick)followSoon();else if(fresh){pending++;latest.hidden=false;latest.lastElementChild.textContent=pending}return row}
function addTranslation(message){const row=entries.get(message.messageId);if(!row||Number(row.dataset.revision||0)!==message.revision)return;const target=[...row.querySelectorAll('.translation')].find(item=>item.dataset.lang===message.lang);if(!target)return;const body=target.querySelector('p'),ok=message.status==='ok';body.className=ok?'':'error';body.textContent=ok?message.body:DATA.strings.failed;if(ok)mark(body,message.editedAt);if(stick)followSoon()}
function merge(entry){addSource({messageId:entry[0],lang:entry[1],body:entry[2],speakerName:entry[3],createdAt:entry[4],revision:entry[5],editedAt:entry[6]});for(const item of entry[8])addTranslation({messageId:entry[0],lang:item[0],body:item[1],status:item[2],revision:entry[5],editedAt:entry[6]})}
async function sync(){try{const response=await fetch(location.pathname+'?since='+watermark,{cache:'no-store'}),data=await response.json();for(const entry of data.entries)merge(entry);watermark=data.snapshotAt;if(data.closed){ended=true;closed.textContent=' · '+DATA.strings.closed}}catch(e){}}
function connect(){connection.textContent=DATA.strings.reconnecting;const scheme=location.protocol==='https:'?'wss':'ws',socket=new WebSocket(scheme+'://'+location.host+'/ws?token='+encodeURIComponent(DATA.token));socket.onopen=async()=>{retry=0;connection.textContent=DATA.strings.connected;await sync();if(ended)socket.close()};socket.onmessage=event=>{try{const message=JSON.parse(event.data);if(message.t==='message')addSource(message);else if(message.t==='translation')addTranslation(message);else if(message.t==='meeting-closed'){ended=true;closed.textContent=' · '+DATA.strings.closed;socket.close()}}catch(e){}};socket.onclose=()=>{connection.textContent=DATA.strings.disconnected;if(!ended)timer=setTimeout(connect,Math.min(10000,500*2**retry++))};socket.onerror=()=>socket.close()}
scroll.addEventListener('scroll',()=>{stick=scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<=80;if(stick){pending=0;latest.hidden=true}},{passive:true});window.ResizeObserver&&new ResizeObserver(()=>{if(stick)followSoon()}).observe(entriesNode);addEventListener('resize',refollow,{passive:true});window.visualViewport?.addEventListener('resize',refollow,{passive:true});latest.onclick=()=>{stick=true;pending=0;latest.hidden=true;follow()};
language.onchange=()=>{document.cookie=DATA.languageCookie+'='+encodeURIComponent(language.value)+'; path=/; max-age='+DATA.languageCookieAge+'; samesite=lax';location.reload()};function applyTheme(){const dark=root.dataset.theme==='dark'||(!root.dataset.theme&&matchMedia('(prefers-color-scheme:dark)').matches);theme.textContent=dark?DATA.strings.light:DATA.strings.dark}theme.onclick=()=>{const dark=root.dataset.theme==='dark'||(!root.dataset.theme&&matchMedia('(prefers-color-scheme:dark)').matches);root.dataset.theme=dark?'light':'dark';try{localStorage.setItem('lct.theme',root.dataset.theme)}catch(e){}applyTheme()};
function applySize(next){root.dataset.size=next;size.textContent=labels[sizes.indexOf(next)];try{localStorage.setItem('lct.fontSize',next)}catch(e){}refollow()}document.getElementById('smaller').onclick=()=>applySize(sizes[Math.max(0,sizes.indexOf(root.dataset.size||'md')-1)]);document.getElementById('larger').onclick=()=>applySize(sizes[Math.min(sizes.length-1,sizes.indexOf(root.dataset.size||'md')+1)]);
applyTheme();size.textContent=labels[sizes.indexOf(root.dataset.size||'md')];followSoon();if(!DATA.closed)connect();else connection.textContent=DATA.strings.disconnected;
`;
