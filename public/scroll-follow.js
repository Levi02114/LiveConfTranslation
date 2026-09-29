/** Shared by React inputs and lightweight output pages without a React dependency. */
/** @param {HTMLElement} scroll @param {HTMLElement} content @param {HTMLButtonElement} button */
export function createScrollFollow(scroll, content, button) {
  let following = true, frame = 0, top = scroll.scrollTop, touchY = 0;
  const unread = new Set();
  const versions = new Map();
  const badge = button.querySelector("[data-unread]");
  function paint() {
    badge.textContent = String(unread.size);
    badge.hidden = unread.size === 0;
    button.dataset.unread = String(unread.size > 0);
  };
  function follow() {
    if (!following || frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      if (following) { scroll.scrollTop = scroll.scrollHeight; top = scroll.scrollTop; }
    });
  };
  function jump() { following = true; unread.clear(); paint(); follow(); }
  function onScroll() {
    const next = scroll.scrollTop;
    const bottom = scroll.scrollHeight - scroll.clientHeight - next <= 4;
    if (next < top - 1 && !bottom) following = false;
    else if (bottom && next >= top) { following = true; unread.clear(); paint(); }
    top = next;
  };
  // Cancel a queued follow before a wheel/touch/key scroll is applied by the browser.
  function wheel(event) { if (event.deltaY < 0) following = false; }
  function touchStart(event) { touchY = event.touches[0]?.clientY ?? 0; }
  function touchMove(event) {
    const next = event.touches[0]?.clientY ?? touchY;
    if (next > touchY) following = false;
    touchY = next;
  };
  function key(event) {
    if (["ArrowUp", "PageUp", "Home"].includes(event.key)) following = false;
  };
  scroll.addEventListener("scroll", onScroll, { passive: true });
  scroll.addEventListener("wheel", wheel, { passive: true });
  scroll.addEventListener("touchstart", touchStart, { passive: true });
  scroll.addEventListener("touchmove", touchMove, { passive: true });
  scroll.addEventListener("keydown", key);
  button.addEventListener("click", jump);
  window.addEventListener("resize", follow, { passive: true });
  window.visualViewport?.addEventListener("resize", follow, { passive: true });
  const observer = "ResizeObserver" in window ? new ResizeObserver(follow) : null;
  observer?.observe(content); observer?.observe(scroll);
  paint(); follow();
  return {
    update(id, version, initial = false) {
      if (versions.get(id) === version) return;
      versions.set(id, version);
      if (!initial && !following) { unread.add(id); paint(); }
      follow();
    },
    follow,
    destroy() {
      cancelAnimationFrame(frame); observer?.disconnect();
      scroll.removeEventListener("scroll", onScroll); scroll.removeEventListener("wheel", wheel);
      scroll.removeEventListener("touchstart", touchStart); scroll.removeEventListener("touchmove", touchMove);
      scroll.removeEventListener("keydown", key); button.removeEventListener("click", jump);
      window.removeEventListener("resize", follow); window.visualViewport?.removeEventListener("resize", follow);
    },
  };
}
