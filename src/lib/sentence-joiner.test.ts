import assert from "node:assert/strict";
import test from "node:test";
import { SentenceJoiner } from "./sentence-joiner";

test("joins turns cut mid-sentence and carries the unfinished tail forward", () => {
  const joiner = new SentenceJoiner();
  assert.deepEqual(joiner.push("Los daños subjetivos provocados por la traición", "es", "a", 0), []);
  assert.deepEqual(joiner.push("De las direcciones y el rol histórico del estalinismo.", "es", "b", 15_000), [
    { text: "Los daños subjetivos provocados por la traición De las direcciones y el rol histórico del estalinismo.", lang: "es", key: "b" },
  ]);
  assert.deepEqual(joiner.push("Creo que tenemos que ver si hay evoluciones de ese punto de vista o no. Nosotros tenemos la", "es", "c", 30_000), [
    { text: "Creo que tenemos que ver si hay evoluciones de ese punto de vista o no.", lang: "es", key: "c" },
  ]);
  assert.equal(joiner.holding(), true);
  assert.deepEqual(joiner.flush(), { text: "Nosotros tenemos la", lang: "es", key: "c:tail" });
  assert.equal(joiner.holding(), false);
});

test("does not split decimals and keeps closing quotes with the sentence", () => {
  const joiner = new SentenceJoiner();
  assert.deepEqual(joiner.push('Subió 3.5 por ciento. Él dijo "basta." Y luego', "es", "a", 0), [
    { text: 'Subió 3.5 por ciento. Él dijo "basta."', lang: "es", key: "a" },
  ]);
});

test("a long tail is released at a clause, or whole when it has none", () => {
  const joiner = new SentenceJoiner({ maxHoldMs: 20_000 });
  joiner.push("primera parte sin final", "es", "a", 0);
  assert.deepEqual(joiner.push("y sigue hablando, sin parar nunca", "es", "b", 21_000), [
    { text: "primera parte sin final y sigue hablando,", lang: "es", key: "b" },
  ]);
  assert.deepEqual(joiner.flush(), { text: "sin parar nunca", lang: "es", key: "b:tail" });
  joiner.push("otra frase", "es", "c", 30_000);
  assert.deepEqual(joiner.push("sin comas tampoco", "es", "d", 60_000), [{ text: "otra frase sin comas tampoco", lang: "es", key: "d" }]);
});

test("a language change releases the previous tail first", () => {
  const joiner = new SentenceJoiner();
  joiner.push("hola a todos", "es", "a", 0);
  assert.deepEqual(joiner.push("안녕하세요.", "ko", "b", 1_000), [
    { text: "hola a todos", lang: "es", key: "a:tail" },
    { text: "안녕하세요.", lang: "ko", key: "b" },
  ]);
  assert.deepEqual(joiner.push("", "ko", "c", 2_000), []);
});

test("a word split by a hard cut is replaced by its complete form from the overlapped turn", () => {
  const joiner = new SentenceJoiner();
  joiner.push("Hablamos de la econo", "es", "a", 0);
  assert.deepEqual(joiner.push("economía mundial.", "es", "b", 15_000, true), [{ text: "Hablamos de la economía mundial.", lang: "es", key: "b" }]);
  joiner.push("Compré una nueva la", "es", "c", 20_000);
  assert.deepEqual(joiner.push("lavadora ayer.", "es", "d", 30_000), [{ text: "Compré una nueva la lavadora ayer.", lang: "es", key: "d" }],
    "without the server's cut-word verdict the tail is kept");
});
