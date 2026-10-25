import { HELIUS_API, COINGECKO_SOL, USDC, USDT, WSOL } from "./constants.js";
import { ScanError, isCancel } from "./errors.js";
import { pool, short } from "./util.js";
import { getMarkets } from "./markets.js";

export async function fetchSwaps(client, addr, max) {
  const key = client.heliusKey();
  if (!key) throw new ScanError("HELIUS_REQUIRED", "PnL needs a Helius API key");
  let out = [], before = null;
  while (out.length < max) {
    const url = HELIUS_API + addr + "/transactions?api-key=" + encodeURIComponent(key) + "&type=SWAP&limit=100" + (before ? "&before=" + before : "");
    const page = await client.jfetch(url);
    if (!Array.isArray(page) || !page.length) break;
    out = out.concat(page); before = page[page.length - 1].signature;
    if (page.length < 100) break;
  }
  return out;
}

// SOL price over the last year (CoinGecko) with today's price as fallback. at(ts) gives the price at a unix time.
export async function solHistory(client) {
  let cur = 0, pts = null;
  try { const mkr = await getMarkets(client, [WSOL]); cur = Number((mkr.data[WSOL] && mkr.data[WSOL].priceUsd) || 0); } catch (e) { if (isCancel(e)) throw e; }
  try { const j = await client.jfetch(COINGECKO_SOL); pts = j && j.prices; } catch (e) { if (isCancel(e)) throw e; }
  return priceSeries(pts, cur);
}

export function priceSeries(pts, cur) {
  const approx = !(pts && pts.length);
  return {
    approx: approx, now: cur, at: function (ts) {
      if (approx) return cur;
      const ms = ts * 1000;
      let lo = 0, hi = pts.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (pts[mid][0] < ms) lo = mid + 1; else hi = mid; }
      return pts[lo][1];
    }
  };
}

// Real net balance change of the wallet in each swap (balances are the most reliable source)
export function parseTrades(addr, txs, sol) {
  const out = [];
  txs.forEach(function (tx) {
    if (!tx || tx.transactionError || !tx.accountData) return;
    const d = {};
    let nat = 0;
    tx.accountData.forEach(function (ad) {
      if (ad.account === addr) nat += Number(ad.nativeBalanceChange || 0) / 1e9;
      (ad.tokenBalanceChanges || []).forEach(function (c) {
        if (c.userAccount !== addr || !c.mint || !c.rawTokenAmount) return;
        const q = Number(c.rawTokenAmount.tokenAmount || 0) / Math.pow(10, Number(c.rawTokenAmount.decimals || 0));
        d[c.mint] = (d[c.mint] || 0) + q;
      });
    });
    const solDelta = nat + (d[WSOL] || 0), usdDelta = (d[USDC] || 0) + (d[USDT] || 0);
    delete d[WSOL]; delete d[USDC]; delete d[USDT];
    const bases = Object.keys(d).filter(function (m) { return Math.abs(d[m]) > 0; });
    if (bases.length !== 1) return;                         // swaps with several tokens at once are ignored
    const m = bases[0], q = d[m], flow = usdDelta + solDelta * sol.at(tx.timestamp);   // net dollars in (+) or out (-) of the wallet
    if (Math.abs(flow) < 5) return;                         // tiny trades: noise
    if (q > 0 && flow < 0) out.push({ t: tx.timestamp, mint: m, side: "buy", qty: q, usd: -flow });
    else if (q < 0 && flow > 0) out.push({ t: tx.timestamp, mint: m, side: "sell", qty: -q, usd: flow });
  });
  out.sort(function (a, b) { return a.t - b.t; });
  return out;
}

// FIFO PnL. Only what has a known entry price counts as realized; open lots are valued at today's price.
export function pnlFromTrades(trades, bal, price, sym, approx) {
  const lots = {};
  let realized = 0, costClosed = 0;
  trades.forEach(function (t) {
    const L = lots[t.mint] || (lots[t.mint] = []);
    if (t.side === "buy") { L.push({ q: t.qty, c: t.usd }); return; }
    let need = t.qty, cost = 0, cov = 0;
    while (need > 1e-12 && L.length) {
      const l = L[0], take = Math.min(l.q, need), part = l.c * (take / l.q);
      cost += part; l.c -= part; l.q -= take; need -= take; cov += take;
      if (l.q <= 1e-12) L.shift();
    }
    if (cov > 0) { realized += t.usd * (cov / t.qty) - cost; costClosed += cost; }
  });
  const open = [];
  let unreal = 0, costOpen = 0, noPrice = 0;
  Object.keys(lots).forEach(function (m) {
    const L = lots[m];
    let q = 0, c = 0;
    L.forEach(function (l) { q += l.q; c += l.c; });
    if (q <= 0) return;
    const have = (bal && bal[m]) || 0;
    if (have < q) { c = c * (have / q); q = have; }        // if it no longer has that many tokens (moved them), trim
    if (q <= 1e-9) return;
    const p = price[m] || 0, v = q * p;
    if (!p) noPrice++;
    unreal += v - c; costOpen += c;
    open.push({ mint: m, sym: (sym && sym[m]) || short(m), q: q, cost: c, entry: c / q, price: p, value: v, ret: c > 0 ? (v - c) / c : null });
  });
  open.sort(function (a, b) { return b.value - a.value; });
  const base = costClosed + costOpen, total = realized + unreal;
  const p = { n: trades.length, since: trades.length ? trades[0].t : 0, realized: realized, unreal: unreal, total: total, base: base, ret: base > 0 ? total / base : null, open: open.slice(0, 5), noPrice: noPrice, ts: Date.now() };
  p.st = pnlStatus(p, approx);
  return p;
}

// win | lose | flat | unk
export function pnlStatus(p, approx) {
  if (!p || p.n < 3 || !(p.base >= 100)) return "unk";
  if (approx) return "unk";   // without real SOL price history there is no reliable base to say win or lose
  if (p.ret >= 0.05) return "win";
  if (p.ret <= -0.05) return "lose";
  return "flat";
}

/**
 * Estimated result of each wallet from its last ~300 swaps (needs a Helius key).
 *
 * @param addrs      wallets
 * @param balances   {wallet: {mint: amount}} current holdings (from getTokens), to trim moved tokens
 * @returns {pnl: {wallet: result|null}, down, approx}
 */
export async function estimatePnl(client, addrs, balances, opts) {
  opts = opts || {};
  if (!client.heliusKey()) throw new ScanError("HELIUS_REQUIRED", "PnL needs a Helius API key");
  const sol = await solHistory(client);
  if (sol.approx && !(sol.now > 0)) throw new ScanError("SOL_PRICE", "no SOL price available");
  const tb = {};
  let done = 0, down = false;
  await pool(addrs, 3, async function (a) {
    if (down) { tb[a] = null; return; }
    try { tb[a] = parseTrades(a, await fetchSwaps(client, a, opts.maxSwaps || 300), sol); }
    catch (e) {
      if (isCancel(e)) throw e;
      tb[a] = null;
      if (e.code === "NETWORK" || (e.code === "HTTP" && (e.data.status === 401 || e.data.status === 403))) down = true;
    }
    done++; if (opts.onStep) opts.onStep(done, addrs.length);
  });
  const set = {};
  addrs.forEach(function (a) { (tb[a] || []).forEach(function (t) { set[t.mint] = 1; }); });
  const ms = Object.keys(set);
  const mk = ms.length ? (await getMarkets(client, ms)).data : {};
  const price = {}, sym = {};
  Object.keys(mk).forEach(function (m) { price[m] = Number(mk[m].priceUsd || 0); sym[m] = (mk[m].baseToken && mk[m].baseToken.symbol) || short(m); });
  const out = {};
  addrs.forEach(function (a) { out[a] = tb[a] ? pnlFromTrades(tb[a], (balances && balances[a]) || {}, price, sym, sol.approx) : null; });
  return { pnl: out, down: down, approx: sol.approx };
}
