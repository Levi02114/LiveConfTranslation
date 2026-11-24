import assert from "node:assert/strict";
import test from "node:test";
import { dropOverlap as dropOverlapResult } from "./transcript-overlap";

const dropOverlap = (prev: string, next: string) => dropOverlapResult(prev, next).text;

test("removes words repeated by the overlapped audio, ignoring case, accents and punctuation", () => {
  assert.equal(dropOverlap("Nosotros tenemos la responsabilidad", "La responsabilidad, de actuar ahora."), "de actuar ahora.");
  assert.equal(dropOverlap("y el rol histórico", "historico del estalinismo."), "del estalinismo.");
});

test("keeps the complete form of a word the hard cut split or misheard", () => {
  assert.deepEqual(dropOverlapResult("hablamos de la econo", "de la economía mundial"), { text: "economía mundial", replaceLastWord: true });
  // 실측(es, test.12): 잘린 단어가 다른 단어로 들렸다.
  assert.deepEqual(dropOverlapResult("gustando mucho de examinar escaparates, de oír sin prestar", "De oír sin perder sílaba discursos"),
    { text: "perder sílaba discursos", replaceLastWord: true });
  assert.deepEqual(dropOverlapResult("y luego la casa", "la puerta estaba abierta"), { text: "la puerta estaba abierta", replaceLastWord: false },
    "one shared short word is not evidence of a misheard cut");
});

test("leaves text alone when nothing overlaps", () => {
  assert.equal(dropOverlap("Fin de la frase.", "Otra cosa distinta."), "Otra cosa distinta.");
  assert.equal(dropOverlap("", "hola"), "hola");
  assert.equal(dropOverlap("dijo que a", "a veces llueve"), "a veces llueve", "a one-letter match is too weak to remove");
});

test("falls back to characters for scripts without spaces", () => {
  assert.equal(dropOverlap("วันนี้เราจะคุยเรื่องเศรษฐกิจ", "เรื่องเศรษฐกิจของประเทศไทย"), "ของประเทศไทย");
});
