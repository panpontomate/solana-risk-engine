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
  const c = searchWorld([sp("OLD", NOW - 350 * DAY, 8000), sp("MINE", NOW - 79 * DAY, 8800), sp("OLD", NOW - 300 * DAY, 9000),
    sp("OTHERCHAIN", NOW - 900 * DAY, 1e6, { chainId: "base" }), sp("RENAMED", NOW - 999 * DAY, 1e6, { baseToken: { address: "RENAMED", symbol: "Spotify", name: "Spotify Cat" } })]);
  const mine = pair({ baseToken: { address: "MINE", symbol: "Spotify", name: "Spotify Wrapped" }, pairCreatedAt: NOW - 79 * DAY });
  const r = await copiesOf(c, "MINE", mine, NOW);
  assert.deepEqual(r, { n: 1, original: "OLD", days: 350, origLiq: 9000, liq: 8800 });
  // the original itself is not a copy
  const o = await copiesOf(c, "OLD", pair({ baseToken: { address: "OLD", symbol: "Spotify", name: "Spotify Wrapped" }, pairCreatedAt: NOW - 350 * DAY }), NOW);
  assert.equal(o, null);
  assert.match(describe({ code: "COPYCAT", s: "warn", data: r }, "es"), /^Hay otro token con el mismo nombre y ticker; el más antiguo \(OLD…OLD, de hace 350 días\)/);
});

test("copiesOf: nothing else, or DexScreener down, is no signal", async () => {
  assert.equal(await copiesOf(searchWorld([]), "MINE", pair({ baseToken: { symbol: "Spotify", name: "Spotify" } })), null);
  const down = createClient({ fetch: mockFetch({ http: {} }), retryDelayMs: 0 });
  assert.equal(await copiesOf(down, "MINE", pair({ baseToken: { symbol: "Spotify", name: "Spotify" } })), null);
});
