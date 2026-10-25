import test from "node:test";
import assert from "node:assert/strict";
import { tokenType, buildLights, levelFrom, dataOnly, score, reasonsFrom, realLiq, impostorOf, INFLATED_RATIO, USDC, WSOL, FAMOUS } from "../src/index.js";

const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 1);

function info(o) {
  return Object.assign({ mintAuth: null, freezeAuth: null, supply: 1e15, decimals: 6, ext: [], authKind: {} }, o);
}
function pair(o) {
  return Object.assign({ baseToken: { symbol: "TEST", name: "Test" }, priceUsd: "0.5", liquidity: { usd: 500000 }, volume: { h24: 100000 }, pairCreatedAt: NOW - 400 * DAY }, o);
}
const goodConc = { ok: true, w1: 3, w10: 12, prog: 5, nW: 10 };

test("tokenType", () => {
  assert.equal(tokenType(null, pair()), null);
  assert.equal(tokenType(info(), pair(), NOW), "OPEN");
  assert.equal(tokenType(info({ mintAuth: "X", authKind: { X: "wallet" } }), pair(), NOW), "CREATOR");
  assert.equal(tokenType(info({ mintAuth: "X", authKind: { X: "program" } }), pair(), NOW), "BRIDGED");
  assert.equal(tokenType(info({ ext: ["permanentDelegate"] }), pair(), NOW), "TOKENIZED");
  const usdPair = pair({ baseToken: { symbol: "USDX", name: "USD X" }, priceUsd: "1.001", liquidity: { usd: 300000 } });
  assert.equal(tokenType(info(), usdPair, NOW), "STABLE");
  // a "USD" token that is only 5 days old is not trusted as a stablecoin
  assert.equal(tokenType(info(), Object.assign({}, usdPair, { pairCreatedAt: NOW - 5 * DAY }), NOW), "OPEN");
});

test("a clean veteran token is low risk", () => {
  const i = info(), p = pair();
  const lights = buildLights(i, goodConc, p, 0, tokenType(i, p, NOW), null, NOW);
  assert.deepEqual(lights.map((l) => l.s), ["ok", "ok", "ok", "ok"]);
  assert.equal(lights[0].items[0].code, "CTL_NONE");
  assert.equal(levelFrom(lights).lvl, "LOW");
  assert.deepEqual(reasonsFrom(lights), []);
});

test("creator with mint authority and tiny liquidity is high risk", () => {
  const i = info({ mintAuth: "X", authKind: { X: "wallet" } }), p = pair({ liquidity: { usd: 3000 }, pairCreatedAt: NOW - 2 * DAY });
  const lights = buildLights(i, goodConc, p, 0, tokenType(i, p, NOW), null, NOW);
  assert.equal(lights[0].s, "bad");
  assert.equal(lights[0].items[0].code, "CTL_MINT_ACTIVE");
  assert.equal(lights[2].s, "bad");
  assert.deepEqual(lights[2].items.map((x) => x.code), ["MKT_LIQ_VERY_LOW", "MKT_NEW"]);
  assert.equal(lights[2].items[1].data.days, 2);
  const lf = levelFrom(lights);
  assert.equal(lf.lvl, "HIGH");
  assert.equal(lf.sev, 6);
});

test("concentration thresholds, softened for stable/tokenized/bridged", () => {
  const i = info(), p = pair();
  const high = { ok: true, w1: 40, w10: 80, prog: 25, nW: 5 };
  let l = buildLights(i, high, p, 0, "OPEN", null, NOW)[1];
  assert.equal(l.s, "bad");
  assert.equal(l.items[0].code, "CON_HIGH");
  assert.equal(l.items[0].data.prog, 25);
  l = buildLights(i, high, p, 0, "BRIDGED", null, NOW)[1];
  assert.equal(l.s, "warn");
  l = buildLights(i, { ok: true, w1: 20, w10: 40, prog: 0, nW: 5 }, p, 0, "OPEN", null, NOW)[1];
  assert.equal(l.s, "warn");
  l = buildLights(i, null, p, 0, "OPEN", null, NOW)[1];
  assert.equal(l.s, "na");
  assert.equal(l.items[0].code, "CON_UNAVAILABLE");
  l = buildLights(i, { ok: false, top1: 50, top10: 90 }, p, 0, "OPEN", null, NOW)[1];
  assert.equal(l.items[0].code, "CON_UNSPLIT");
  assert.equal(l.s, "warn");
});

test("missing check caps the level at medium, and dataOnly detects it", () => {
  const i = info(), p = pair();
  const lights = buildLights(i, { skip: true }, p, 0, "OPEN", null, NOW);
  const lf = levelFrom(lights);
  assert.equal(lf.lvl, "MEDIUM");
  assert.equal(lf.sev, 1);
  assert.equal(dataOnly({ lvl: lf.lvl, lights: lights }), true);
});

test("a market under 7 days is never low risk, other single warnings still are", () => {
  // like MAYA or KURUMI in the real-token study: hours old, nothing else wrong
  const i = info(), fresh = pair({ pairCreatedAt: NOW - 0.3 * DAY });
  const lights = buildLights(i, goodConc, fresh, 0, "OPEN", null, NOW);
  assert.deepEqual(lights.map((l) => l.s), ["ok", "ok", "warn", "ok"]);
  assert.equal(levelFrom(lights).lvl, "MEDIUM");
  assert.equal(levelFrom(buildLights(i, goodConc, pair({ pairCreatedAt: NOW - 8 * DAY }), 0, "OPEN", null, NOW)).lvl, "LOW");
  // like mSOL, JitoSOL or RENDER: a program-controlled mint is normal for the type and stays low
  const lst = info({ mintAuth: "P", authKind: { P: "program" } });
  const l2 = buildLights(lst, goodConc, pair(), 0, "BRIDGED", null, NOW);
  assert.equal(l2[3].s, "warn");
  assert.equal(levelFrom(l2).lvl, "LOW");
});

test("RugCheck unlocked LP only counts on young, non-soft markets", () => {
  const i = info(), young = pair({ pairCreatedAt: NOW - 20 * DAY }), old = pair();
  let m = buildLights(i, goodConc, young, 0, "OPEN", { lpLockedPct: 5 }, NOW)[2];
  assert.equal(m.s, "bad");
  assert.equal(m.items[0].code, "MKT_LP_UNLOCKED");
  m = buildLights(i, goodConc, young, 0, "OPEN", { lpLockedPct: 40 }, NOW)[2];
  assert.equal(m.items[0].code, "MKT_LP_PARTLY_LOCKED");
  m = buildLights(i, goodConc, old, 0, "OPEN", { lpLockedPct: 5 }, NOW)[2];
  assert.equal(m.s, "ok");
  m = buildLights(i, goodConc, young, 0, "STABLE", { lpLockedPct: 5 }, NOW)[2];
  assert.equal(m.s, "ok");
});

test("heavy position and bridged off-Solana note", () => {
  const i = info({ mintAuth: "P", authKind: { P: "program" } }), p = pair({ liquidity: { usd: 20000 } });
  const lights = buildLights(i, goodConc, p, 5000, "BRIDGED", null, NOW);
  assert.deepEqual(lights[2].items.map((x) => x.code), ["MKT_LIQ_LOW", "MKT_POSITION_HEAVY"]);
  assert.equal(lights[2].items[0].data.offSolana, true);
  assert.equal(lights[3].items[0].code, "DEP_PROGRAM_AUTHORITY");
  assert.equal(lights[0].items[0].code, "CTL_ONLY_PROGRAMS");
});

test("spam score for tokens without a market", () => {
  assert.equal(score(null).pts, 30);
  const s = score(info({ mintAuth: "X", freezeAuth: "X", authKind: { X: "wallet" }, ext: ["transferHook"] }));
  assert.equal(s.pts, 25 + 20 + 15);
  assert.deepEqual(s.why.map((x) => x.code), ["MINT_ACTIVE", "FREEZE_ACTIVE", "EXTENSION", "NO_MARKET"]);
  assert.equal(s.why[0].data.byWallet, true);
  assert.equal(score(info()).pts, 0);
});

test("realLiq exposes inflated pools", () => {
  // 2 real USDC against billions of the token, reported as $4,000M
  const p = { quoteToken: { address: USDC }, priceNative: "1", priceUsd: "1", liquidity: { usd: 4e9, quote: 1 } };
  realLiq(p);
  assert.equal(p.liqRaw, 4e9);
  assert.equal(p.liquidity.usd, 2);
  const honest = { quoteToken: { address: WSOL }, priceNative: "0.01", priceUsd: "1.5", liquidity: { usd: 300000, quote: 1000 } };
  realLiq(honest);
  assert.equal(honest.liqRaw, undefined);
  const other = { quoteToken: { address: "Other111" }, priceNative: "1", priceUsd: "1", liquidity: { usd: 4e9, quote: 1 } };
  realLiq(other);
  assert.equal(other.liqRaw, undefined);
});

test("realLiq leaves lopsided concentrated-liquidity pools alone (5% threshold)", () => {
  // JTO's main Orca Whirlpool as DexScreener reported it: $258k, of which only ~12% is SOL
  const jto = { quoteToken: { address: WSOL }, priceNative: "0.004131", priceUsd: "0.4172", liquidity: { usd: 258439.3, quote: 157.4872 } };
  realLiq(jto);
  assert.equal(jto.liqRaw, undefined);
  assert.equal(jto.liquidity.usd, 258439.3);
  // the same pool with only 3% real side is flagged
  const thin = { quoteToken: { address: USDC }, priceNative: "1", priceUsd: "1", liquidity: { usd: 100000, quote: 1500 } };
  realLiq(thin);
  assert.equal(thin.liqRaw, 100000);
  assert.equal(thin.liquidity.usd, 3000);
  assert.equal(INFLATED_RATIO, 0.05);
});

test("impostorOf catches copies of famous tokens", () => {
  assert.deepEqual(impostorOf("Fake111", { baseToken: { symbol: "$BONK" } }), { sym: "BONK", real: FAMOUS.BONK });
  assert.deepEqual(impostorOf("Fake111", { baseToken: { symbol: "USDC.e?", name: "USD Coin" } }), { sym: "USDC", real: USDC });
  assert.equal(impostorOf(FAMOUS.BONK, { baseToken: { symbol: "BONK" } }), null);
  assert.equal(impostorOf("Fake111", { baseToken: { symbol: "NEWCOIN" } }), null);
});
