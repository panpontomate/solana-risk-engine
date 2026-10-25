import { USDC, USDT, WSOL } from "./constants.js";
import { ScanError, isCancel } from "./errors.js";
import { pool, progress, short } from "./util.js";
import { getTokens } from "./tokens.js";
import { getMarkets } from "./markets.js";

// Stablecoins and SOL move all the time for normal reasons: they are not "what this wallet bought"
const SKIP = { [USDC]: 1, [USDT]: 1, [WSOL]: 1 };

// A snapshot is {mint: {q: amount, v: usd value, s: symbol}} with only priced tokens worth >= $1.
// A low cap made a token from the tail reappear as "new" on the next check just for having left
// the picture; 300 entries (a few KB) covers almost any real wallet.
export function capSnap(h, max) {
  const ks = Object.keys(h).sort(function (a, b) { return h[b].v - h[a].v; });
  const out = {};
  ks.slice(0, max || 300).forEach(function (k) { out[k] = h[k]; });
  return out;
}

// Changes between two snapshots of one wallet: new | more | less | sold, with the USD value involved
export function chgDiff(prev, now) {
  const out = [];
  Object.keys(now).forEach(function (m) {
    const n = now[m], p = prev[m];
    if (!p) { if (n.v >= 20) out.push({ k: "new", m: m, s: n.s, v: n.v }); return; }
    if (n.q < p.q * 0.05) return;                                   // treated as "sold"
    const price = n.v / n.q;
    if (n.q >= p.q * 1.25 && (n.q - p.q) * price >= 50) out.push({ k: "more", m: m, s: n.s, v: (n.q - p.q) * price });
    else if (n.q <= p.q * 0.75 && (p.q - n.q) * price >= 50) out.push({ k: "less", m: m, s: n.s, v: (p.q - n.q) * price });
  });
  Object.keys(prev).forEach(function (m) {
    const p = prev[m], n = now[m];
    if (p.v >= 20 && (!n || n.q < p.q * 0.05)) out.push({ k: "sold", m: m, s: p.s, v: p.v });
  });
  return out;
}

// Across many wallets: which tokens most of them bought and which they sold.
// rows = [{ch: chgDiff(...)}]; each wallet counts once per token and side.
export function chgAgg(rows) {
  const buy = {}, sell = {};
  rows.forEach(function (r) {
    const seenB = {}, seenS = {};
    r.ch.forEach(function (c) {
      const up = (c.k === "new" || c.k === "more"), M = up ? buy : sell, seen = up ? seenB : seenS;
      const o = M[c.m] || (M[c.m] = { m: c.m, s: c.s, n: 0, v: 0 });
      o.v += c.v;
      if (!seen[c.m]) { o.n++; seen[c.m] = 1; }
    });
  });
  function list(M) { return Object.keys(M).map(function (k) { return M[k]; }).sort(function (a, b) { return b.n - a.n || b.v - a.v; }); }
  return { buy: list(buy), sell: list(sell) };
}

/**
 * Today's snapshot of each wallet. Store it wherever you like (browser, database) and pass the stored
 * one back to diffSnapshots next time.
 *
 * @returns {ts, snapshots: {wallet: snapshot}, failed}
 */
export async function takeSnapshots(client, addrs, opts) {
  opts = opts || {};
  const onProgress = opts.onProgress;
  const cur = {};
  let failed = 0, d = 0;
  await pool(addrs, 3, async function (a) {
    try { cur[a] = (await getTokens(client, a)).tokens; } catch (e) { if (isCancel(e)) throw e; failed++; }
    d++; progress(onProgress, "wallets", 0.05 + 0.4 * d / addrs.length, { done: d, total: addrs.length });
  });
  const ok = addrs.filter(function (a) { return cur[a]; });
  if (!ok.length) throw new ScanError("TOO_FEW_WALLETS", "could not read any wallet", { n: 0, total: addrs.length });
  const set = {};
  ok.forEach(function (a) { Object.keys(cur[a]).forEach(function (m) { if (!SKIP[m]) set[m] = 1; }); });
  progress(onProgress, "markets", 0.5);
  const ms = Object.keys(set);
  const mkr = ms.length ? await getMarkets(client, ms, function (dn, n) { progress(onProgress, "markets", 0.5 + 0.45 * dn / n, { done: dn, total: n }); }) : { data: {}, failed: [] };
  // A partial failure reading prices cannot be treated as "sold everything": better to abort and retry
  if (mkr.failed.length) throw new ScanError("DEX_UNREACHABLE", "some prices could not be read");
  const mk = mkr.data, snapshots = {};
  ok.forEach(function (a) {
    const now = {};
    Object.keys(cur[a]).forEach(function (m) {
      if (SKIP[m]) return;
      const pair = mk[m], price = Number((pair && pair.priceUsd) || 0), q = cur[a][m], v = q * price;
      if (price > 0 && v >= 1) now[m] = { q: q, v: Math.round(v * 100) / 100, s: (pair.baseToken && pair.baseToken.symbol) || short(m) };
    });
    snapshots[a] = capSnap(now);
  });
  progress(onProgress, "done", 1);
  return { ts: Date.now(), snapshots: snapshots, failed: failed };
}

/**
 * @param prev  {wallet: {ts, h: snapshot}} what you stored last time (missing wallets = first check)
 * @param next  result of takeSnapshots
 * @returns {rows: [{a, first, since, ch}], agg: chgAgg(rows that had a previous snapshot)}
 */
export function diffSnapshots(prev, next) {
  prev = prev || {};
  const rows = Object.keys(next.snapshots).map(function (a) {
    const p = prev[a];
    return { a: a, first: !p, since: p ? p.ts : 0, ch: p ? chgDiff(p.h, next.snapshots[a]) : [] };
  });
  return { rows: rows, agg: chgAgg(rows.filter(function (r) { return !r.first; })) };
}
