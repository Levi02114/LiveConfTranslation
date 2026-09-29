export { createScrollFollow } from "../../public/scroll-follow.js";

export const FOLLOW_SCROLL_CSS = `
.scroll-latest{position:absolute;z-index:5;right:max(1rem,env(safe-area-inset-right));bottom:max(1rem,env(safe-area-inset-bottom));display:flex;align-items:center;justify-content:center;width:2rem;height:2rem;min-width:32px;min-height:32px;border:1px solid var(--line);border-radius:50%;background:var(--bg);color:var(--fg);font:1rem/1 system-ui;cursor:pointer;box-shadow:0 1px 4px var(--line)}
.scroll-latest::after{content:"";position:absolute;inset:-6px;border-radius:50%}
.scroll-latest:focus-visible{outline:2px solid var(--fg);outline-offset:3px}
.scroll-latest[data-unread=true]{background:var(--fg);color:var(--bg)}
.scroll-latest [data-unread]{position:absolute;bottom:calc(100% + .25rem);right:0;min-width:1.25rem;padding:.15rem .3rem;border:1px solid var(--bg);border-radius:1rem;background:var(--fg);color:var(--bg);font:.6875rem/1.2 system-ui}
.scroll-latest [hidden]{display:none!important}
`;
