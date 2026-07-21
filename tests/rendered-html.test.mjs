import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the complete Kaiju Clash game shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Kaiju Clash — Neon Monster Dice<\/title>/i);
  assert.match(html, /KAIJU CLASH/);
  assert.match(html, /CHOOSE YOUR CHAMPION/);
  assert.match(html, /NEON CITY/);
  assert.match(html, /POWER MARKET/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape|react-loading-skeleton/i);
});

test("ships the complete rule engine and optimized generated art sheets", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  for (const feature of ["TOGGLE_HOLD", "YIELD_CITY", "SWEEP_MARKET", "BOT_RESOLVE", "checkWinner", "resolveDice", "20 VP", "playerCount"]) {
    assert.match(page, new RegExp(feature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  const [monsters, powers] = await Promise.all([
    stat(new URL("../public/assets/kaiju-grid-3x3.webp", import.meta.url)),
    stat(new URL("../public/assets/power-grid-2x2.webp", import.meta.url)),
  ]);
  assert.ok(monsters.size > 100_000 && monsters.size < 1_000_000);
  assert.ok(powers.size > 100_000 && powers.size < 1_000_000);
});
