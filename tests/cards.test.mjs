import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cards = JSON.parse(await readFile(new URL("../app/cards.json", import.meta.url), "utf8"));

test("the market uses the 66-card 2016 base deck", () => {
  assert.equal(cards.length, 66);
  assert.equal(new Set(cards.map((card) => card.id)).size, 66);
  assert.equal(cards.filter((card) => card.name === "Extra Head").length, 2);
  assert.equal(cards.filter((card) => card.name === "Evacuation Orders").length, 2);
  assert.equal(cards.filter((card) => card.name === "Acid Attack")[0].cost, 6);
  assert.equal(cards.filter((card) => card.name === "Friend of Children")[0].cost, 3);
  assert.equal(cards.filter((card) => card.name === "Wings")[0].cost, 6);
});

test("every card has a real cost, type, and gameplay description", () => {
  for (const card of cards) {
    assert.match(card.name, /\S/);
    assert.ok(Number.isInteger(card.cost) && card.cost >= 2 && card.cost <= 8);
    assert.ok(card.type === "KEEP" || card.type === "DISCARD");
    assert.match(card.description, /\S/);
    assert.ok(card.ability || card.instant);
  }
});
