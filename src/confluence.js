import { ADDRESS_RE, KNOWN } from "./constants.js";
import { ScanError, isCancel } from "./errors.js";
import { pool, progress, short } from "./util.js";
import { getTokens } from "./tokens.js";
import { getMarkets } from "./markets.js";
import { assess } from "./risk.js";
import { estimatePnl } from "./pnl.js";
import { holderBase, holderRows, markBusy } from "./holders.js";

/**
 * Confluence: tokens that several wallets hold in common, each with its risk.
 *
 * @param wallets                 at least 2 addresses
 * @param [opts.pct=30]           a token must be held by at least this % of the wallets (and never fewer than 2)
 * @param [opts.withPnl=false]    estimate each wallet's result first (needs Helius)
 * @param [opts.pnlFilter="all"]  keep only wallets whose result is win | lose | flat | unk (implies withPnl)
 * @returns {ts, wallets, allWallets, failed, minN, noMarket, marketFailed, rows, pnl, notes}
 */
export async function confluence(client, wallets, opts) {
  opts = opts || {};
  const onProgress = opts.onProgress;
  const pct = opts.pct === undefined ? 30 : opts.pct;
  const filter = opts.pnlFilter || "all";
  const withPnl = !!opts.withPnl || filter !== "all";
  if (!wallets || wallets.length < 2) throw new ScanError("TOO_FEW_WALLETS", "add at least 2 wallets", { n: wallets ? wallets.length : 0 });
  const data = {};
  let failed = 0, d = 0;
  await pool(wallets, 3, async function (a) {
    try { data[a] = (await getTokens(client, a)).tokens; } catch (e) { if (isCancel(e)) throw e; failed++; }
    d++; progress(onProgress, "wallets", 0.05 + 0.3 * d / wallets.length, { done: d, total: wallets.length });
  });
  let ok = wallets.filter(function (a) { return data[a]; });
  if (ok.length < 2) throw new ScanError("TOO_FEW_WALLETS", "could not read at least 2 wallets", { n: ok.length, total: wallets.length });
  const okAll = ok, notes = [];
  let pnlSnap = null;
  if (withPnl && !client.heliusKey()) {
    if (filter !== "all") throw new ScanError("HELIUS_REQUIRED", "the result filter needs a Helius API key");
    notes.push("PNL_NO_HELIUS");
  } else if (withPnl) {
    progress(onProgress, "pnl", 0.3);
    const pr = await estimatePnl(client, ok, data, { onStep: function (dn, n) { progress(onProgress, "pnl", 0.3 + 0.1 * dn / n, { done: dn, total: n }); } });
    pnlSnap = {};
    ok.forEach(function (a) { if (pr.pnl[a]) pnlSnap[a] = pr.pnl[a]; });
    if (pr.down) notes.push("PNL_PARTIAL");
    if (pr.approx) notes.push("PNL_APPROX");
    if (filter !== "all") {
      ok = ok.filter(function (a) { return pr.pnl[a] && pr.pnl[a].st === filter; });
      if (ok.length < 2) throw new ScanError("TOO_FEW_WALLETS", "only " + ok.length + " wallets pass the result filter", { n: ok.length, total: okAll.length, filter: filter });
    }
  }
  const minN = Math.max(2, Math.ceil(pct / 100 * ok.length));
  const count = {};
  ok.forEach(function (a) { Object.keys(data[a]).forEach(function (m) { count[m] = (count[m] || 0) + 1; }); });
  const cand = Object.keys(count).filter(function (m) { return count[m] >= minN; });
  progress(onProgress, "markets", 0.4);
  const mkr = cand.length ? await getMarkets(client, cand, function (dn, n) { progress(onProgress, "markets", 0.4 + 0.15 * dn / n, { done: dn, total: n }); }) : { data: {}, failed: [] };
  const mk = mkr.data, rows = [];
  let noMarket = 0;
  cand.forEach(function (m) {
    const pair = mk[m], price = Number((pair && pair.priceUsd) || 0);
    if (!pair || !(price > 0)) { noMarket++; return; }
    const hs = [];
    ok.forEach(function (a) { const q = data[a][m]; if (q && q * price >= 1) hs.push({ a: a, v: q * price }); });   // dust (< $1) ignored
    if (hs.length < minN) return;
    hs.sort(function (x, y) { return y.v - x.v; });
    rows.push({ mint: m, pair: pair, hs: hs, n: hs.length, total: hs.reduce(function (s, x) { return s + x.v; }, 0) });
  });
  let done = 0;
  const todo = rows.filter(function (r) { return !KNOWN[r.mint]; });
  await pool(todo, 3, async function (r) {
    let a = null;
    try { a = await assess(client, r.mint, r.pair); } catch (e) { if (isCancel(e)) throw e; }
    r.a = a; done++;
    progress(onProgress, "tokens", 0.55 + 0.45 * done / Math.max(1, todo.length), { done: done, total: todo.length });
  });
  const out = [];
  rows.forEach(function (r) {
    const a = r.a, liq = (r.pair.liquidity && r.pair.liquidity.usd) || 0, common = { n: r.n, total: r.total, liq: liq, pairAddress: r.pair.pairAddress || "", holders: r.hs };
    if (KNOWN[r.mint]) out.push(Object.assign({ mint: r.mint, sym: KNOWN[r.mint], name: "", lvl: "LOW", sev: 0, type: null, lights: null, known: true, img: null }, common));
    else if (a) out.push(Object.assign({ mint: r.mint, sym: a.sym, name: a.name, lvl: a.lvl, sev: a.sev, type: a.type, lights: a.lights, known: false, img: a.img }, common));
  });
  out.sort(function (x, y) { return y.n - x.n || y.total - x.total; });
  progress(onProgress, "done", 1);
  return { ts: Date.now(), wallets: ok.length, allWallets: okAll.length, failed: failed, minN: minN, pct: pct, noMarket: noMarket, marketFailed: mkr.failed.length, rows: out, pnl: pnlSnap, notes: notes };
}

/**
 * The reverse: wallets (people, not bots or exchanges) that are top holders of several tokens at once.
 *
 * @param mints             2 to 6 token addresses
 * @param [opts.min=2]      in how many of the tokens a wallet must appear
 * @returns {ts, tokens, min, rows: [{a, hits: [{m, s, pct}], total}], dropped}
 */
export async function commonHolders(client, mints, opts) {
  opts = opts || {};
  const onProgress = opts.onProgress;
  mints = (mints || []).filter(function (x, i, l) { return ADDRESS_RE.test(x) && l.indexOf(x) === i; }).slice(0, 6);
  if (mints.length < 2) throw new ScanError("TOO_FEW_TOKENS", "give at least 2 token addresses");
  const map = {}, toks = [];
  for (let i = 0; i < mints.length; i++) {
    const b = await holderBase(client, mints[i], function (st, f) { progress(onProgress, "token", (i + f * 0.9) / mints.length * 0.8, { index: i + 1, total: mints.length, sub: st.step }); });
    const hr = holderRows(b);
    const sym = (b.pair && b.pair.baseToken && b.pair.baseToken.symbol) || short(mints[i]);
    toks.push({ mint: mints[i], sym: sym });
    hr.rows.forEach(function (r) {
      if (r.kind !== "wallet") return;
      (map[r.owner] = map[r.owner] || []).push({ m: mints[i], s: sym, pct: r.pct });
    });
  }
  const min = Math.min(Number(opts.min) || 2, mints.length);
  const cands = Object.keys(map).filter(function (a) { return map[a].length >= min; });
  const kind = {};
  cands.forEach(function (a) { kind[a] = "wallet"; });
  await markBusy(client, kind, cands, function (c, n) { progress(onProgress, "bots", 0.8 + 0.2 * c / Math.max(1, n), { done: c, total: n }); });
  const keep = cands.filter(function (a) { return kind[a] === "wallet"; });
  const rows = keep.map(function (a) { return { a: a, hits: map[a], total: map[a].reduce(function (s, x) { return s + x.pct; }, 0) }; })
    .sort(function (x, y) { return y.hits.length - x.hits.length || y.total - x.total; });
  progress(onProgress, "done", 1);
  return { ts: Date.now(), tokens: toks, min: min, rows: rows, dropped: cands.length - keep.length };
}
