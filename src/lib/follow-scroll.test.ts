import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";

test("lightweight viewer scripts remain valid JavaScript", () => {
  for (const route of ["out", "all"]) {
    const source = readFileSync(`src/app/${route}/[token]/route.ts`, "utf8");
    const client = source.split("const CLIENT = String.raw`\n")[1].split("\n`;")[0];
    assert.doesNotThrow(() => new vm.Script(client));
  }
});

test("shared scroll controller preserves reading, counts unique updates and resumes only at bottom", () => {
  class Element extends EventTarget {
    private top = 0; scrollHeight = 1000; clientHeight = 200;
    get scrollTop() { return this.top; }
    set scrollTop(value: number) { this.top = Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight)); }
    dataset: Record<string, string> = {}; hidden = false; textContent = "";
    querySelector() { return badge; }
  }
  const scroll = new Element(), content = new Element(), button = new Element(), badge = new Element();
  const frames = new Map<number, () => void>(); let id = 0, resized = () => {};
  const window = new EventTarget();
  Object.assign(window, { ResizeObserver: true });
  const context = vm.createContext({ window, Set, Map,
    requestAnimationFrame: (fn: () => void) => { frames.set(++id, fn); return id; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    ResizeObserver: class { constructor(fn: () => void) { resized = fn; } observe() {} disconnect() {} },
  });
  // Exercise the exact browser module used by lightweight /out and /all.
  const source = readFileSync("public/scroll-follow.js", "utf8").replace("export function", "function");
  const controller = vm.runInContext(`${source}\ncreateScrollFollow`, context)(scroll, content, button);
  const flush = () => { for (const fn of frames.values()) fn(); frames.clear(); scroll.scrollTop = Math.min(scroll.scrollTop, scroll.scrollHeight - scroll.clientHeight); };
  const move = (top: number) => { scroll.scrollTop = top; scroll.dispatchEvent(new Event("scroll")); };
  controller.update("1", "initial", true); flush(); move(800);
  move(400);
  controller.update("2", "source"); controller.update("2", "translation"); controller.update("3", "source");
  scroll.scrollHeight = 1200; resized(); window.dispatchEvent(new Event("resize")); flush();
  assert.equal(scroll.scrollTop, 400); assert.equal(badge.textContent, "2"); assert.equal(badge.hidden, false);
  button.dispatchEvent(new Event("click")); flush(); move(1000);
  assert.equal(scroll.scrollTop, 1000); assert.equal(badge.hidden, true);
  scroll.scrollHeight = 1500; controller.update("4", "source"); resized(); flush(); move(1300);
  assert.equal(scroll.scrollTop, 1300);
  controller.update("5", "source");
  scroll.dispatchEvent(Object.assign(new Event("wheel"), { deltaY: -100 })); move(1100); flush();
  assert.equal(scroll.scrollTop, 1100, "queued follow must not override an upward wheel");
  move(1300); scroll.scrollHeight = 1600; controller.update("6", "source"); flush();
  assert.equal(scroll.scrollTop, 1400, "manual bottom scroll resumes following");
  controller.destroy(); assert.equal(frames.size, 0);
});
