import test from "node:test";
import assert from "node:assert/strict";
import {
  b58bytes, onCurve, isOnCurve, clusterByFunder, holderRows, chgDiff, chgAgg, capSnap, diffSnapshots,
  parseTrades, pnlFromTrades, pnlStatus, priceSeries, USDC, WSOL, SYSTEM_PROGRAM
} from "../src/index.js";

test("b58bytes decodes 32-byte keys only", () => {
  assert.deepEqual(b58bytes(SYSTEM_PROGRAM), new Array(32).fill(0));
  assert.equal(b58bytes("0OIl"), null);       // characters outside base58
  assert.equal(b58bytes("abc"), null);        // too short for a key
  assert.equal(b58bytes(USDC).length, 32);
});

test("onCurve: ed25519 base point is on the curve, y >= p is not", () => {
  // base point: y = 4/5, encoded little-endian as 0x58 followed by 31 x 0x66
  const base = [0x58].concat(new Array(31).fill(0x66));
  assert.equal(onCurve(base), true);
  const tooBig = new Array(32).fill(0xff);   // top bit cleared -> 2^255 - 1 >= p
  assert.equal(onCurve(tooBig), false);
  assert.equal(onCurve(null), false);
  assert.equal(isOnCurve("not-base58!"), false);
});

test("clusterByFunder groups wallets sharing a funder, ignoring hot sources", () => {
  const funders = { w1: "F1", w2: "F1", w3: "F2", w4: "EX", w5: "EX", w6: null };
  let c = clusterByFunder(funders);
  assert.equal(c.w1.id, c.w2.id);
  assert.equal(c.w1.n, 2);
  assert.equal(c.w3, undefined);              // alone: not a pattern
  assert.ok(c.w4);
  c = clusterByFunder(funders, { EX: 1 });
  assert.equal(c.w4, undefined);
  assert.equal(c.w1.id, "A");
});

test("holderRows sums accounts per owner and ranks by % of supply", () => {
  const b = {
    info: { supply: 1000, decimals: 1 }, pair: { priceUsd: "2" },
    largest: [{ address: "a1", amount: "300" }, { address: "a2", amount: "100" }, { address: "a3", amount: "250" }],
    owners: ["O1", "O2", "O1"], kind: { O1: "wallet", O2: "program" }
  };
  const r = holderRows(b, { O1: 5 });
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].owner, "O1");
  assert.ok(Math.abs(r.rows[0].pct - 55) < 1e-9);
  assert.equal(r.rows[0].tokens, 55);
  assert.equal(r.rows[0].value, 110);
  assert.equal(r.rows[0].busy, 5);
  assert.equal(r.rows[1].rank, 2);
});

test("chgDiff detects new, more, less and sold", () => {
  const prev = { A: { q: 100, v: 100, s: "A" }, B: { q: 100, v: 1000, s: "B" }, C: { q: 100, v: 500, s: "C" }, D: { q: 100, v: 300, s: "D" } };
  const now = { A: { q: 200, v: 200, s: "A" }, B: { q: 50, v: 500, s: "B" }, C: { q: 1, v: 5, s: "C" }, E: { q: 10, v: 25, s: "E" } };
  const ch = chgDiff(prev, now);
  const by = Object.fromEntries(ch.map((c) => [c.m, c]));
  assert.equal(by.A.k, "more");
  assert.equal(by.A.v, 100);
  assert.equal(by.B.k, "less");
  assert.equal(by.B.v, 500);
  assert.equal(by.C.k, "sold");
  assert.equal(by.D.k, "sold");
  assert.equal(by.E.k, "new");
  // small moves are noise
  assert.deepEqual(chgDiff({ A: { q: 100, v: 100, s: "A" } }, { A: { q: 130, v: 130, s: "A" } }), []);
});

test("chgAgg counts each wallet once per token and side", () => {
  const rows = [
    { ch: [{ k: "new", m: "X", s: "X", v: 30 }, { k: "more", m: "X", s: "X", v: 10 }] },
    { ch: [{ k: "more", m: "X", s: "X", v: 60 }, { k: "sold", m: "Y", s: "Y", v: 99 }] }
  ];
  const g = chgAgg(rows);
  assert.equal(g.buy[0].n, 2);
  assert.equal(g.buy[0].v, 100);
  assert.equal(g.sell[0].m, "Y");
});

test("capSnap keeps the most valuable entries", () => {
  const h = {};
  for (let i = 0; i < 10; i++) h["m" + i] = { q: 1, v: i, s: "S" };
  assert.deepEqual(Object.keys(capSnap(h, 3)).sort(), ["m7", "m8", "m9"]);
});

test("diffSnapshots marks first checks and aggregates the rest", () => {
  const next = { snapshots: { w1: { X: { q: 10, v: 100, s: "X" } }, w2: {} } };
  const prev = { w1: { ts: 1, h: {} } };
  const d = diffSnapshots(prev, next);
  assert.equal(d.rows.find((r) => r.a === "w1").ch[0].k, "new");
  assert.equal(d.rows.find((r) => r.a === "w2").first, true);
  assert.equal(d.agg.buy[0].m, "X");
});

test("parseTrades reads net balance changes per swap", () => {
  const me = "ME";
  const sol = priceSeries(null, 100);   // flat $100 SOL
  const txs = [
    { timestamp: 10, accountData: [{ account: me, nativeBalanceChange: -1e9, tokenBalanceChanges: [{ userAccount: me, mint: "T", rawTokenAmount: { tokenAmount: "1000", decimals: 0 } }] }] },
    { timestamp: 20, accountData: [{ account: me, nativeBalanceChange: 0, tokenBalanceChanges: [
      { userAccount: me, mint: "T", rawTokenAmount: { tokenAmount: "-500", decimals: 0 } },
      { userAccount: me, mint: USDC, rawTokenAmount: { tokenAmount: "150000000", decimals: 6 } }] }] },
    { timestamp: 30, transactionError: {}, accountData: [] },
    { timestamp: 40, accountData: [{ account: me, nativeBalanceChange: -1e6, tokenBalanceChanges: [{ userAccount: me, mint: "T", rawTokenAmount: { tokenAmount: "1", decimals: 0 } }] }] }
  ];
  const t = parseTrades(me, txs, sol);
  assert.equal(t.length, 2);   // the failed tx and the $0.10 one are ignored
  assert.deepEqual(t[0], { t: 10, mint: "T", side: "buy", qty: 1000, usd: 100 });
  assert.deepEqual(t[1], { t: 20, mint: "T", side: "sell", qty: 500, usd: 150 });
  // wrapped SOL counts as SOL
  const w = parseTrades(me, [{ timestamp: 5, accountData: [{ account: me, nativeBalanceChange: 0, tokenBalanceChanges: [
    { userAccount: me, mint: WSOL, rawTokenAmount: { tokenAmount: "-2000000000", decimals: 9 } },
    { userAccount: me, mint: "T", rawTokenAmount: { tokenAmount: "10", decimals: 0 } }] }] }], sol);
  assert.equal(w[0].usd, 200);
});

test("pnlFromTrades: FIFO realized + unrealized", () => {
  const trades = [
    { t: 1, mint: "T", side: "buy", qty: 100, usd: 100 },
    { t: 2, mint: "T", side: "buy", qty: 100, usd: 200 },
    { t: 3, mint: "T", side: "sell", qty: 150, usd: 300 }
  ];
  const p = pnlFromTrades(trades, { T: 50 }, { T: 3 }, { T: "TT" }, false);
  // sold 100 @1 + 50 @2 = cost 200 for 300 -> +100 realized; 50 left cost 100 worth 150 -> +50
  assert.equal(Math.round(p.realized), 100);
  assert.equal(Math.round(p.unreal), 50);
  assert.equal(Math.round(p.base), 300);
  assert.equal(p.st, "win");
  assert.equal(p.open[0].sym, "TT");
  // moved tokens away: open lot is trimmed to what the wallet still has
  const moved = pnlFromTrades(trades, { T: 0 }, { T: 3 }, {}, false);
  assert.equal(moved.open.length, 0);
});

test("pnlStatus needs enough trades and a real SOL history", () => {
  assert.equal(pnlStatus({ n: 2, base: 1000, ret: 1 }), "unk");
  assert.equal(pnlStatus({ n: 5, base: 50, ret: 1 }), "unk");
  assert.equal(pnlStatus({ n: 5, base: 500, ret: 1 }, true), "unk");
  assert.equal(pnlStatus({ n: 5, base: 500, ret: -0.2 }), "lose");
  assert.equal(pnlStatus({ n: 5, base: 500, ret: 0.01 }), "flat");
});

test("priceSeries finds the price at a time", () => {
  const s = priceSeries([[1000, 10], [2000, 20], [3000, 30]], 99);
  assert.equal(s.at(1.5), 20);
  assert.equal(s.at(3), 30);
  assert.equal(priceSeries([], 99).at(1), 99);
});
