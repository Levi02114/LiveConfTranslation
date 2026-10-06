import assert from "node:assert/strict";
import test from "node:test";

import { copyText } from "./clipboard";

test("복사는 모달 안에서 주소를 선택하고 실패해도 임시 입력과 포커스를 정리한다", async () => {
  const originals = ["document", "navigator", "HTMLElement"].map((key) =>
    [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  try {
    for (const mode of ["modal", "denied", "page", "modern", "blocked", "throws", "false"] as const) {
      const url = "https://clipboard-test.trycloudflare.com";
      const modal = mode !== "page" && mode !== "modern";
      let copied = "복사";
      let attached = false;
      let copyCalls = 0;
      class Element {
        isConnected = true;
        parentElement: Element | null = null;
        style = {};
        value = "";
        selectionStart = 0;
        selectionEnd = 0;
        setAttribute() {}
        closest() { return modal ? dialog : null; }
        appendChild(child: Element) { attached = true; child.parentElement = this; }
        removeChild() { attached = false; }
        remove() { attached = false; }
        focus() {
          if (this !== area || (mode !== "blocked" && (!modal || this.parentElement === dialog))) doc.activeElement = this;
        }
        select() { this.focus(); this.setSelectionRange(0, this.value.length); }
        setSelectionRange(start: number, end: number) { this.selectionStart = start; this.selectionEnd = end; }
      }
      const button = new Element();
      const dialog = new Element();
      const body = new Element();
      const area = new Element();
      const doc = {
        body, activeElement: button,
        createElement: () => area,
        querySelector: () => modal ? dialog : null,
        execCommand: () => {
          copyCalls++;
          if (mode === "throws") throw new Error("clipboard blocked");
          if (mode === "false") return false;
          if (doc.activeElement === area) copied = area.value.slice(area.selectionStart, area.selectionEnd);
          return true;
        },
      };
      const clipboard = mode === "modern" || mode === "denied" ? {
        writeText: async (text: string) => {
          if (mode === "denied") throw new Error("permission denied");
          copied = text;
        },
      } : undefined;
      for (const [key, value] of Object.entries({ document: doc, navigator: { clipboard }, HTMLElement: Element })) {
        Object.defineProperty(globalThis, key, { configurable: true, value });
      }
      const expected = !["blocked", "throws", "false"].includes(mode);
      assert.equal(await copyText(url), expected, mode);
      assert.equal(copied, expected ? url : "복사", mode);
      assert.equal(attached, false, `${mode}: temporary textarea removed`);
      assert.equal(doc.activeElement, button, `${mode}: focus restored`);
      if (mode === "blocked" || mode === "modern") assert.equal(copyCalls, 0, mode);
    }
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});
