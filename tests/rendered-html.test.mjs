import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

test("ships the complete Kaiju Clash game shell", async () => {
  const [page, layout] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(layout, /Kaiju Clash — Monster Dice Mayhem/i);
  for (const copy of ["KAIJU CLASH", "PICK YOUR MONSTER", "TOKYO BAY", "POWER MARKET", "SINGLE PLAYER", "MULTIPLAYER"]) assert.match(page, new RegExp(copy, "i"));
  assert.doesNotMatch(page, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships the full rule engine, rooms, sound pack, and optimized art", async () => {
  const [page, cards] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/cards.json", import.meta.url), "utf8").then(JSON.parse),
  ]);
  for (const feature of ["TOGGLE_HOLD", "YIELD_CITY", "SWEEP_MARKET", "BOT_RESOLVE", "checkWinner", "resolveDice", "20 VP", "playerCount", "NEW_MULTI", "/api/rooms/", "crypto.getRandomValues"]) {
    assert.match(page, new RegExp(feature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.equal(cards.length, 66);
  assert.ok(cards.every((card) => card.type === "KEEP" || card.type === "DISCARD"));
  const assets = await Promise.all([
    stat(new URL("../public/assets/kaiju-grid-3x3.webp", import.meta.url)),
    stat(new URL("../public/assets/power-grid-2x2.webp", import.meta.url)),
    stat(new URL("../public/sounds/dice-roll.mp3", import.meta.url)),
    stat(new URL("../public/sounds/victory-roar.mp3", import.meta.url)),
  ]);
  assert.ok(assets.every((asset) => asset.size > 5_000));
});
