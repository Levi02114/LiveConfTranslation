import { getStrings } from "@/lib/i18n";
import { getLanguage, textDirection } from "@/lib/languages";
import { formatClock } from "@/lib/log-format";
import { getMeeting, getPageByToken, getRecentOutput, isPageEnabled } from "@/lib/repo";

type Params = { params: Promise<{ token: string }> };

/**
 * 참석자 출력은 400 kb/s 회선에서도 바로 떠야 한다.
 * React/Next 런타임과 전역 폰트를 싣지 않고 이 경로만 완결된 HTML로 보낸다.
 */
export async function GET(request: Request, { params }: Params) {
  const { token } = await params;
  const page = getPageByToken(token);
  if (!page || page.kind !== "output" || !page.lang || !isPageEnabled(page)) {
    return new Response("Not Found", { status: 404 });
  }

  const meeting = getMeeting(page.meetingId);
  if (!meeting) return new Response("Not Found", { status: 404 });

  const strings = getStrings(page.lang);
  const language = getLanguage(page.lang);
  const snapshotAt = Date.now();
  const history = getRecentOutput(meeting.id, page.lang);
  const sinceParam = new URL(request.url).searchParams.get("since");
  const since = Number(sinceParam);
  if (sinceParam !== null && Number.isSafeInteger(since) && since >= 0) {
    return Response.json(
      {
        lines: history
          .filter((line) => line.updatedAt >= since)
          .map((line) => [line.messageId, line.body, line.status, line.createdAt, line.speakerName, line.revision, line.editedAt, line.updatedAt]),
        closed: meeting.status === "closed",
        snapshotAt,
      },
      { headers: { "cache-control": "private, no-store" } },
    );
  }
  const data = json({
    token,
    lang: page.lang,
    snapshotAt,
    closed: meeting.status === "closed",
    strings: {
      connected: strings.connection.connected,
      reconnecting: strings.connection.reconnecting,
      disconnected: strings.connection.disconnected,
      closed: strings.meeting.closed,
      failed: strings.status.failed,
      waiting: strings.status.waiting,
      newMessages: strings.status.newMessages,
      edited: strings.message.edited,
      light: strings.appearance.light,
      dark: strings.appearance.dark,
      theme: strings.appearance.theme,
      decrease: strings.appearance.decrease,
      increase: strings.appearance.increase,
    },
  });
  const lines = history
    .map(
      (line) => `<div class="line" data-id="${line.messageId}" data-revision="${line.revision}">
        <time>${formatClock(line.createdAt)}</time>
        <p${line.status === "error" ? ' class="failed"' : ""}>${html(`${line.speakerName ? `(${line.speakerName}) ` : ""}${line.status === "ok" ? line.body : strings.status.failed}`)}${line.editedAt ? `<small class="edited">(${html(strings.message.edited)})</small>` : ""}</p>
      </div>`,
    )
    .join("");
  const closed = meeting.status === "closed" ? ` · ${strings.meeting.closed}` : "";

  return new Response(
    `<!doctype html>
<html lang="${html(page.lang)}" dir="${textDirection(page.lang)}">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${html(language.nativeName)} · ${html(strings.role.output)}</title>
<script>(function(){try{var r=document.documentElement,t=localStorage.getItem('lct.theme'),s=localStorage.getItem('lct.fontSize');if(t)r.dataset.theme=t;r.dataset.size=s||'md'}catch(e){}})()</script>
<style>${CSS}</style>
</head>
<body>
<nav><button id="theme" type="button" title="${html(strings.appearance.theme)}"></button><button id="smaller" type="button" aria-label="${html(strings.appearance.decrease)}">−</button><span id="size">md</span><button id="larger" type="button" aria-label="${html(strings.appearance.increase)}">＋</button></nav>
<header><h1>${html(language.nativeName)}</h1><div><span>${html(strings.role.output)}</span> · <span id="connection">${html(strings.connection.reconnecting)}</span><span id="closed">${html(closed)}</span></div><small>${html(meeting.title)}</small></header>
<main id="scroll"><section id="lines" aria-live="polite">${lines}</section><p id="waiting"${history.length ? " hidden" : ""}>${html(strings.status.waiting)}</p></main>
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
*{box-sizing:border-box}html,body{height:100%;margin:0}body{display:flex;flex-direction:column;overflow:hidden;background:var(--bg);color:var(--fg);font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
nav{position:fixed;z-index:2;top:10px;right:14px;display:flex;align-items:center;gap:8px;background:var(--bg);color:var(--muted);font:.6875rem ui-monospace,monospace}button,#size{height:1.3rem}button{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--line);background:var(--bg);color:inherit;padding:0 8px;font:inherit;cursor:pointer}#theme{width:calc(5.75em + 18px);flex:none;font-size:clamp(10px,.5rem,16px)}#size{display:inline-flex;min-width:44px;align-items:center;justify-content:center}button:hover{background:var(--fg);color:var(--bg)}
header{flex:none;border-bottom:1px solid var(--line);padding:3.375rem 32px 20px}header>*{display:block;max-width:1040px;margin-left:auto;margin-right:auto}h1{margin-top:0;margin-bottom:6px;font-size:1.6875rem;font-weight:500}header div,small,#waiting{color:var(--muted);font:.75rem ui-monospace,monospace}small{margin-top:5px;font-size:.6875rem}
main{min-height:0;flex:1;overflow-y:auto;padding:0 32px}section,#waiting{width:100%;max-width:1040px;margin:auto;padding:24px 0 64px}section{display:flex;min-height:100%;flex-direction:column;justify-content:flex-end}section:empty{min-height:0;padding:0}.line{display:grid;grid-template-columns:auto minmax(0,1fr);gap:18px;padding:10px 0;content-visibility:auto;contain-intrinsic-size:0 54px}.line time{white-space:nowrap;padding-top:.35em;color:var(--muted);font:.75rem ui-monospace,monospace}.line p{min-width:0;margin:0;white-space:pre-wrap;text-wrap:pretty;font-size:var(--text);line-height:1.5}.line .failed{color:var(--muted);font-style:italic}.line .waiting{color:var(--muted)}
.edited{display:block;margin-top:.35rem;color:var(--muted);font:.6875rem ui-monospace,monospace}
#latest{position:fixed;bottom:max(28px,env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);border-color:var(--fg);font-size:.8125rem}
[hidden]{display:none!important}@media(max-width:640px){nav{left:12px;right:12px;justify-content:flex-end}header{padding:3.375rem 16px 18px}main{padding:0 16px}.line{grid-template-columns:1fr;gap:2px}.line time{padding-top:0}section,#waiting{padding-bottom:48px}}
`;

const CLIENT = String.raw`
const root=document.documentElement,scroll=document.getElementById('scroll'),lines=document.getElementById('lines'),waiting=document.getElementById('waiting'),connection=document.getElementById('connection'),closed=document.getElementById('closed'),latest=document.getElementById('latest'),theme=document.getElementById('theme'),size=document.getElementById('size');
const rows=new Map(),sizes=['sm','md','lg','xl','xxl'],labels=['80%','100%','125%','150%','200%'];let stick=true,pending=0,retry=0,timer,ended=DATA.closed,watermark=DATA.snapshotAt;document.querySelectorAll('.line').forEach(row=>rows.set(Number(row.dataset.id),row));
function clock(at){const d=new Date(at),p=n=>String(n).padStart(2,'0');return p(d.getHours())+':'+p(d.getMinutes())+':'+p(d.getSeconds())}
function follow(){scroll.scrollTop=scroll.scrollHeight}function followSoon(){requestAnimationFrame(()=>requestAnimationFrame(follow))}function refollow(){stick=true;pending=0;latest.hidden=true;followSoon()}
function mark(body,edited){body.querySelector('.edited')?.remove();if(edited){const note=document.createElement('small');note.className='edited';note.textContent='('+DATA.strings.edited+')';body.append(note)}}
function add(message){let row=rows.get(message.messageId),fresh=!row,previous=row?Number(row.dataset.revision||0):-1;if(row&&message.revision<previous)return;if(!row&&message.t==='message'&&message.lang!==DATA.lang)return;waiting.hidden=true;if(!row){row=document.createElement('div');row.className='line';row.dataset.id=message.messageId;row.append(document.createElement('time'),document.createElement('p'));lines.append(row);rows.set(message.messageId,row)}row.dataset.revision=message.revision;const time=row.querySelector('time'),body=row.querySelector('p'),isOwn=message.t==='message'&&message.lang===DATA.lang,ok=isOwn||message.t==='translation'&&message.status==='ok';time.textContent=clock(message.sourceCreatedAt||message.createdAt);body.className=ok?'':message.t==='message'?'waiting':'failed';body.textContent=(message.speakerName?'('+message.speakerName+') ':'')+(ok?message.body:message.t==='message'?DATA.strings.waiting:DATA.strings.failed);mark(body,message.editedAt);if(stick)followSoon();else if(fresh){pending++;latest.hidden=false;latest.lastElementChild.textContent=pending}}
async function sync(){try{const response=await fetch(location.pathname+'?since='+watermark,{cache:'no-store'}),data=await response.json();for(const line of data.lines)add({t:'translation',messageId:line[0],body:line[1],status:line[2],createdAt:line[3],speakerName:line[4],revision:line[5],editedAt:line[6]});watermark=data.snapshotAt;if(data.closed){ended=true;closed.textContent=' · '+DATA.strings.closed}}catch(e){}}
function connect(){connection.textContent=DATA.strings.reconnecting;const scheme=location.protocol==='https:'?'wss':'ws',socket=new WebSocket(scheme+'://'+location.host+'/ws?token='+encodeURIComponent(DATA.token));socket.onopen=()=>{retry=0;connection.textContent=DATA.strings.connected;sync()};socket.onmessage=event=>{try{const message=JSON.parse(event.data);if(message.t==='message'||message.t==='translation')add(message);else if(message.t==='meeting-closed'){ended=true;closed.textContent=' · '+DATA.strings.closed;socket.close()}}catch(e){}};socket.onclose=()=>{connection.textContent=DATA.strings.disconnected;if(!ended)timer=setTimeout(connect,Math.min(10000,500*2**retry++))};socket.onerror=()=>socket.close()}
scroll.addEventListener('scroll',()=>{stick=scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<=80;if(stick){pending=0;latest.hidden=true}},{passive:true});addEventListener('resize',refollow,{passive:true});window.visualViewport?.addEventListener('resize',refollow,{passive:true});latest.onclick=()=>{stick=true;pending=0;latest.hidden=true;follow()};
function applyTheme(){const dark=root.dataset.theme==='dark'||(!root.dataset.theme&&matchMedia('(prefers-color-scheme:dark)').matches);theme.textContent=dark?DATA.strings.light:DATA.strings.dark}theme.onclick=()=>{const dark=root.dataset.theme==='dark'||(!root.dataset.theme&&matchMedia('(prefers-color-scheme:dark)').matches);root.dataset.theme=dark?'light':'dark';try{localStorage.setItem('lct.theme',root.dataset.theme)}catch(e){}applyTheme()};
function applySize(next){root.dataset.size=next;size.textContent=labels[sizes.indexOf(next)];try{localStorage.setItem('lct.fontSize',next)}catch(e){}refollow()}document.getElementById('smaller').onclick=()=>applySize(sizes[Math.max(0,sizes.indexOf(root.dataset.size||'md')-1)]);document.getElementById('larger').onclick=()=>applySize(sizes[Math.min(sizes.length-1,sizes.indexOf(root.dataset.size||'md')+1)]);
applyTheme();size.textContent=labels[sizes.indexOf(root.dataset.size||'md')];followSoon();if(!DATA.closed)connect();else connection.textContent=DATA.strings.disconnected;
`;
