import test from "node:test";
import assert from "node:assert/strict";
import { createClient, brandOf, copiesOf, fakeLiquidity, describe, DEX_SEARCH } from "../src/index.js";
import { mockFetch } from "./helpers.js";

const pair = (o) => Object.assign({ baseToken: { address: "MINE", symbol: "X", name: "X" }, liquidity: { usd: 10000 }, pairCreatedAt: 0 }, o);

test("brandOf: a real company's name on a token nobody issues", () => {
  assert.deepEqual(brandOf(pair({ baseToken: { symbol: "Spotify", name: "Spotify Wrapped 2026" } }), "OPEN"), { brand: "Spotify", exact: true });
  assert.deepEqual(brandOf(pair({ baseToken: { symbol: "SHOP", name: "Shopify" } }), "OPEN"), { brand: "Shopify", exact: true });
  assert.deepEqual(brandOf(pair({ baseToken: { symbol: "GEMMA", name: "Gemma Spotify Cat" } }), "OPEN"), { brand: "Spotify", exact: false });
  assert.deepEqual(brandOf(pair({ baseToken: { symbol: "RB", name: "Red-Bull" } }), "OPEN"), { brand: "Red Bull", exact: true });
  // genuine tokenized shares come from an issuer and are left alone
  assert.equal(brandOf(pair({ baseToken: { symbol: "SHOP", name: "Shopify - Backpack Securities" } }), "TOKENIZED"), null);
  // a word inside another word is not the brand
  assert.equal(brandOf(pair({ baseToken: { symbol: "PINE", name: "Pineapple" } }), "OPEN"), null);
  assert.equal(brandOf(pair({ baseToken: { symbol: "WIF", name: "dogwifhat" } }), "OPEN"), null);
  // accents, apostrophes and "&" in the bigger list
  assert.deepEqual(brandOf(pair({ baseToken: { symbol: "LO", name: "LOREAL" } }), "OPEN"), { brand: "L'Oreal", exact: true });
  assert.deepEqual(brandOf(pair({ baseToken: { symbol: "NES", name: "Nestlé Cat" } }), "OPEN"), { brand: "Nestle", exact: false });
  assert.deepEqual(brandOf(pair({ baseToken: { symbol: "HM", name: "H&M" } }), "OPEN"), { brand: "H&M", exact: true });
  // an everyday word that is also a brand is not on the list
  assert.equal(brandOf(pair({ baseToken: { symbol: "SHELL", name: "Shell" } }), "OPEN"), null);
});

test("brandOf: an established market (30 days and $100k) is not a copy", () => {
  const now = Date.UTC(2026, 9, 30), day = 86400000;
  const bn = { baseToken: { symbol: "BNSOL", name: "Binance Staked SOL" } };
  assert.equal(brandOf(pair(Object.assign({ liquidity: { usd: 5_000_000 }, pairCreatedAt: now - 200 * day }, bn)), "OPEN", now), null);
  // new, or old but thin: still checked
  assert.deepEqual(brandOf(pair(Object.assign({ liquidity: { usd: 5_000_000 }, pairCreatedAt: now - 3 * day }, bn)), "OPEN", now), { brand: "Binance", exact: false });
  assert.deepEqual(brandOf(pair(Object.assign({ liquidity: { usd: 20_000 }, pairCreatedAt: now - 200 * day }, bn)), "OPEN", now), { brand: "Binance", exact: false });
});

test("fakeLiquidity: reported 100 times what is really there", () => {
  assert.equal(fakeLiquidity(pair({ liqRaw: 12_900_000, liquidity: { usd: 52 } })), true);
  assert.equal(fakeLiquidity(pair({ liqRaw: 900_000, liquidity: { usd: 20_000 } })), false);   // inflated, but not faked like that
  assert.equal(fakeLiquidity(pair({})), false);
});

function searchWorld(pairs) {
  return createClient({ fetch: mockFetch({ http: { [DEX_SEARCH]: () => ({ pairs: pairs }) } }), retryDelayMs: 0 });
}
const sp = (addr, at, liq, o) => Object.assign({ chainId: "solana", baseToken: { address: addr, symbol: "Spotify", name: "Spotify Wrapped" }, pairCreatedAt: at, liquidity: { usd: liq } }, o);

test("copiesOf: the oldest token with the same name and ticker is the original", async () => {
  const DAY = 86400000, NOW = 1000 * DAY;
  const c = searchWorld([sp("OLD", NOW - 350 * DAY, 8000), sp("MINE", NOW - 79 * DAY, 8800), sp("OLD", NOW - 300 * DAY, 12000),
    sp("OTHERCHAIN", NOW - 900 * DAY, 1e6, { chainId: "base" }), sp("RENAMED", NOW - 999 * DAY, 1e6, { baseToken: { address: "RENAMED", symbol: "Spotify", name: "Spotify Cat" } })]);
  const mine = pair({ baseToken: { address: "MINE", symbol: "Spotify", name: "Spotify Wrapped" }, pairCreatedAt: NOW - 79 * DAY });
  const r = await copiesOf(c, "MINE", mine, NOW);
  assert.deepEqual(r, { n: 1, original: "OLD", days: 350, origLiq: 12000, liq: 8800 });
  // the original itself is not a copy
  const o = await copiesOf(c, "OLD", pair({ baseToken: { address: "OLD", symbol: "Spotify", name: "Spotify Wrapped" }, pairCreatedAt: NOW - 350 * DAY }), NOW);
  assert.equal(o, null);
  assert.match(describe({ code: "COPYCAT", s: "warn", data: r }, "es"), /^Hay otro token con el mismo nombre y ticker; el más antiguo con mercado real \(OLD…OLD, de hace 350 días\)/);
});

test("copiesOf: relaunches of a dead name are not copies of anything", async () => {
  // registry 29/10: farms launch "pulymerket" 9 times a day; the older ones have no market left
  const H = 3600000, NOW = 1000 * H;
  const c = searchWorld([sp("A", NOW - 5 * H, 40), sp("B", NOW - 3 * H, 0), sp("C", NOW - 2 * H, 9000), sp("MINE", NOW - 1 * H, 3000)]);
  const mine = pair({ baseToken: { address: "MINE", symbol: "Spotify", name: "Spotify Wrapped" }, liquidity: { usd: 3000 }, pairCreatedAt: NOW - H });
  assert.equal(await copiesOf(c, "MINE", mine, NOW), null);
  // one of them with a real market: that is the one being copied, even if it is not the very first
  const c2 = searchWorld([sp("A", NOW - 5 * H, 40), sp("REAL", NOW - 3 * H, 80000), sp("MINE", NOW - 1 * H, 3000)]);
  assert.deepEqual(await copiesOf(c2, "MINE", mine, NOW), { n: 2, original: "REAL", days: 0, origLiq: 80000, liq: 3000 });
});

test("copiesOf: the deeper market is not the trap", async () => {
  // a relaunch or migration that people actually trade more than the older token
  const DAY = 86400000, NOW = 1000 * DAY;
  const c = searchWorld([sp("OLD", NOW - 200 * DAY, 20000), sp("MINE", NOW - 10 * DAY, 300000)]);
  const mine = pair({ baseToken: { address: "MINE", symbol: "Spotify", name: "Spotify Wrapped" }, liquidity: { usd: 300000 }, pairCreatedAt: NOW - 10 * DAY });
  assert.equal(await copiesOf(c, "MINE", mine, NOW), null);
});

test("copiesOf: nothing else, or DexScreener down, is no signal", async () => {
  assert.equal(await copiesOf(searchWorld([]), "MINE", pair({ baseToken: { symbol: "Spotify", name: "Spotify" } })), null);
  const down = createClient({ fetch: mockFetch({ http: {} }), retryDelayMs: 0 });
  assert.equal(await copiesOf(down, "MINE", pair({ baseToken: { symbol: "Spotify", name: "Spotify" } })), null);
});
