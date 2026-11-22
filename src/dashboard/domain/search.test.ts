import assert from "node:assert/strict";
import { test } from "node:test";
import { rank, searchWords } from "./search.ts";

test("what was typed becomes words, and an invoice number is recognised", () => {
  assert.deepEqual(searchWords("  Mt. Storm   bakery "), { text: "Mt. Storm bakery", words: ["mt.", "storm", "bakery"], invoiceNumber: null });
  assert.deepEqual(searchWords("a b farm").words, ["farm"], "one-letter words are dropped when there are others");
  assert.deepEqual(searchWords("a").words, ["a"]);
  assert.deepEqual(searchWords("").words, []);
  for (const text of ["INV-0003", "inv 3", "Invoice 3", "#3", "inv-3"]) assert.equal(searchWords(text).invoiceNumber, 3, text);
  assert.equal(searchWords("3 bakeries").invoiceNumber, null);
  assert.equal(searchWords("x".repeat(300)).text.length, 100);
  assert.equal(searchWords("a b c d e f g h").words.length, 6, "all one-letter words are kept, up to six");
  assert.equal(searchWords("one two three four five six seven").words.length, 6);
});

test("a name that starts with what was typed comes first", () => {
  assert.equal(rank("Mt. Storm Bakery", ["mt.", "storm"]), 0);
  assert.equal(rank("Hinkle Family Farm", ["farm"]), 1);
  assert.equal(rank("Gormania Feed & Supply", ["supp"]), 1);
  assert.equal(rank("Bakery website", ["site"]), 2);
});
