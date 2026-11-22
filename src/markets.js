import { DEX, DEX_PAIRS, DEX_SEARCH, GECKO, USDC, USDT, WSOL, FAMOUS, BRANDS, brandKey, BRAND_MATURE_DAYS, BRAND_MATURE_LIQ, COPY_MIN_LIQ } from "./constants.js";
import { ScanError, isCancel } from "./errors.js";
import { sleep } from "./util.js";

// DexScreener values both sides of a pool at the pool's own price. A scammer creates a pool with
// 4 billion of their token against 2 real USDC and it shows "liquidity $4,000M". What you can actually
// take out when selling is the real-token side (USDC, USDT or SOL): if that is much smaller, it wins.
// Concentrated-liquidity pools (Orca Whirlpools, Raydium CLMM, Meteora DLMM) are lopsided by nature,
// often 10-20% real side, so only an extreme gap counts: real side under 5% of the reported value.
// The scams this targets sit far below that (2 USDC against "$4,000M" is 0.00000005%).
// Mutates the pair: keeps the reported figure in liqRaw and replaces liquidity.usd with the real one.
export const INFLATED_RATIO = 0.05;

export function realLiq(p) {
  const l = p.liquidity, qa = p.quoteToken && p.quoteToken.address;
  if (!l || !l.usd || (qa !== USDC && qa !== USDT && qa !== WSOL)) return;
  const pn = Number(p.priceNative), pu = Number(p.priceUsd), q = Number(l.quote);
  if (!(pn > 0 && pu > 0 && q >= 0)) return;
  const real = 2 * q * pu / pn;   // pu/pn = USD price of the real token
  if (real < INFLATED_RATIO * l.usd) { p.liqRaw = l.usd; p.liquidity = Object.assign({}, l, { usd: real }); }
}

// A token using the symbol (or name) of a famous one but with another address is a copy
export function impostorOf(mint, pair) {
  const b = (pair && pair.baseToken) || {};
  let s = String(b.symbol || "").replace(/[\s$]/g, "").toUpperCase();
  const n = String(b.name || "").trim().toLowerCase();
  if (!FAMOUS[s]) { if (n === "usd coin") s = "USDC"; else if (n === "tether usd" || n === "tether") s = "USDT"; }
  return (FAMOUS[s] && FAMOUS[s] !== mint) ? { sym: s, real: FAMOUS[s] } : null;
}

// Liquidity reported at 100 times what is really there is not a quirk of the pool: it is set up so the
// token looks established (a "Shopify" showing $12.9M with $52 behind it)
export const FAKE_LIQ_RATIO = 100;
export function fakeLiquidity(pair) {
  const real = (pair && pair.liquidity && pair.liquidity.usd) || 0;
  return !!(pair && pair.liqRaw && pair.liqRaw >= FAKE_LIQ_RATIO * Math.max(real, 1));
}

// A real company's name on a token that is not issued by anyone: {brand, exact}. exact = the name or the
// symbol is just the brand ("Spotify"); otherwise the brand is one word of a longer name ("Spotify Cat").
// Established markets (see BRAND_MATURE_DAYS) are left alone
export function brandOf(pair, type, now) {
  if (type === "TOKENIZED" || type === "BRIDGED" || type === "STABLE") return null;
  const liq = (pair && pair.liquidity && pair.liquidity.usd) || 0;
  const days = (pair && pair.pairCreatedAt) ? ((now || Date.now()) - pair.pairCreatedAt) / 86400000 : 0;
  if (days >= BRAND_MATURE_DAYS && liq >= BRAND_MATURE_LIQ) return null;
  const b = (pair && pair.baseToken) || {};
  const name = brandKey(b.name), sym = brandKey(b.symbol);
  for (const w of Object.keys(BRANDS)) {
    if (name === w || sym === w || name.replace(/ /g, "") === w.replace(/ /g, "")) return { brand: BRANDS[w], exact: true };
    if ((" " + name + " ").indexOf(" " + w + " ") >= 0) return { brand: BRANDS[w], exact: false };
  }
  return null;
}

// Other Solana tokens with the same name and symbol (DexScreener search). The oldest one with a real market
// (COPY_MIN_LIQ) is taken as the original. Returns null when nothing else matches, when no older token has a
// real market (relaunches of a dead name), when this token is the oldest, or when this one is the deeper market.
export async function copiesOf(client, mint, pair, now) {
  const b = (pair && pair.baseToken) || {};
  if (!b.symbol) return null;
  const res = await client.softJson(DEX_SEARCH + encodeURIComponent(b.symbol), 8000);
  const norm = function (s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); };
  const sym = norm(b.symbol), name = norm(b.name);
  const by = {};
  ((res && res.pairs) || []).forEach(function (p) {
    const t = p.baseToken || {};
    if (p.chainId !== "solana" || !t.address || norm(t.symbol) !== sym || norm(t.name) !== name) return;
    const cur = by[t.address];
    const liq = (p.liquidity && p.liquidity.usd) || 0, at = p.pairCreatedAt || 0;
    if (!cur) by[t.address] = { addr: t.address, liq: liq, at: at };
    else { cur.liq = Math.max(cur.liq, liq); if (at && (!cur.at || at < cur.at)) cur.at = at; }
  });
  const mine = by[mint] || { addr: mint, liq: (pair.liquidity && pair.liquidity.usd) || 0, at: pair.pairCreatedAt || 0 };
  const others = Object.keys(by).filter(function (a) { return a !== mint; }).map(function (a) { return by[a]; });
  if (!others.length) return null;
  const oldest = others.filter(function (o) { return o.at && o.liq >= COPY_MIN_LIQ; }).sort(function (x, y) { return x.at - y.at; })[0];
  // this token is itself the oldest (or the dates are unknown): it is the original, the others copy it
  if (!oldest || (mine.at && mine.at <= oldest.at)) return null;
  // the market people actually use is this one (a relaunch or migration is not a trap)
  if (mine.liq >= oldest.liq) return null;
  return { n: others.length, original: oldest.addr, days: Math.floor(((now || Date.now()) - oldest.at) / 86400000), origLiq: oldest.liq, liq: mine.liq };
}

// Up to this many tokens, each one gets its own request for all its pools (token-pairs/v1, 4 at a time).
// The batch request (tokens/v1) returns a single pool per token, not always the deepest: measured
// 22/11/2026 on 99 tokens, 15 came out with a much smaller pool (RUSH $0.6M instead of $42M).
// Bigger lists (a wallet with hundreds of tokens) stay on the batch request to respect DexScreener's limits.
export const PAIRS_MAX = 30;

// Best (most liquid) DexScreener pair per mint.
// `failed` lists mints whose batch failed: unknown, which is not the same as "no market".
export async function getMarkets(client, mints, onStep) {
  const best = {};
  let failed = [];
  const keep = function (m, p) {
    realLiq(p);
    const liq = (p.liquidity && p.liquidity.usd) || 0;
    const cur = best[m] && best[m].liquidity && best[m].liquidity.usd || 0;
    if (!best[m] || liq > cur) best[m] = p;
  };
  if (mints.length <= PAIRS_MAX) {
    let next = 0, done = 0;
    const worker = async function () {
      while (next < mints.length) {
        const m = mints[next++];
        try {
          const pares = await client.jfetch(DEX_PAIRS + m);
          if (Array.isArray(pares)) pares.forEach(function (p) {
            if (p && p.baseToken && p.baseToken.address === m && (!p.chainId || p.chainId === "solana")) keep(m, p);
          });
        } catch (e) { if (isCancel(e)) throw e; }
        done++;
        if (onStep && done < mints.length) onStep(done, mints.length);
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()].slice(0, Math.min(4, mints.length)));
    // what got no answer (or no market) goes once more through the batch request
    const rest = mints.filter(function (m) { return !best[m]; });
    if (!rest.length) { if (onStep && mints.length) onStep(mints.length, mints.length); return { data: best, failed: failed }; }
    const again = await batchMarkets(client, rest);
    Object.keys(again.data).forEach(function (m) { best[m] = again.data[m]; });
    if (onStep) onStep(mints.length, mints.length);
    return { data: best, failed: again.failed };
  }
  const r = await batchMarkets(client, mints, onStep);
  return r;
}

// 30 mints per request (tokens/v1)
async function batchMarkets(client, mints, onStep) {
  const best = {};
  let failed = [];
  for (let i = 0; i < mints.length; i += 30) {
    const lote = mints.slice(i, i + 30);
    try {
      const pares = await client.jfetch(DEX + lote.join(","));
      if (Array.isArray(pares)) pares.forEach(function (p) {
        const m = p.baseToken && p.baseToken.address;
        if (lote.indexOf(m) < 0) return;
        realLiq(p);
        const liq = (p.liquidity && p.liquidity.usd) || 0;
        const cur = best[m] && best[m].liquidity && best[m].liquidity.usd || 0;
        if (!best[m] || liq > cur) best[m] = p;
      });
    } catch (e) {
      if (isCancel(e)) throw e;
      if (i === 0 && e.code === "NETWORK") throw new ScanError("DEX_UNREACHABLE", "could not reach DexScreener");
      failed = failed.concat(lote);
    }
    if (onStep) onStep(Math.min(i + 30, mints.length), mints.length);
    if (i + 30 < mints.length) await sleep(250);
  }
  return { data: best, failed: failed };
}

/* ---------- Fake volume: who is actually trading ---------- */
// Volume says nothing about who makes it. Wash trading inflates it with wallets that buy and sell the same
// amount again and again, so the token looks busy and attracts buyers. Measured on the last ~300 trades of
// the main pool (GeckoTerminal, one request): the share of volume from wallets whose buys and sells match
// (within 20%) and how much the 3 biggest wallets move. Calibrated on 14/11/2026: 14 trending tokens 0–47%
// round-trip; a 6-minute-old pool 96%. Arbitrage bots on veteran tokens (JUP: 3 wallets, 84% of volume) are
// normal, so this is only applied to young markets (see risk.js).
export const WASH_MIN_TRADES = 100;     // fewer trades are not enough to judge
export const WASH_ROUND_TRIP = 80;      // % of volume from wallets that buy and sell the same
export const WASH_FEW_WALLETS = 25, WASH_TOP3 = 75;   // also few wallets doing most of it: red

// trades: GeckoTerminal trade attributes. Returns {n, wallets, top3, rt, mins} (percentages 0–100) or null
export function washStats(trades) {
  const t = (Array.isArray(trades) ? trades : []).filter(function (x) { return x && x.tx_from_address && Number(x.volume_in_usd) > 0; });
  if (!t.length) return null;
  const w = {};
  t.forEach(function (x) { const o = w[x.tx_from_address] || (w[x.tx_from_address] = { b: 0, s: 0 }); o[x.kind === "buy" ? "b" : "s"] += Number(x.volume_in_usd); });
  const ws = Object.keys(w).map(function (k) { return w[k]; });
  const tot = ws.reduce(function (a, o) { return a + o.b + o.s; }, 0);
  if (!tot) return null;
  const sizes = ws.map(function (o) { return o.b + o.s; }).sort(function (a, b) { return b - a; });
  const rt = ws.filter(function (o) { return o.b > 0 && o.s > 0 && Math.abs(o.b - o.s) <= 0.2 * (o.b + o.s); }).reduce(function (a, o) { return a + o.b + o.s; }, 0);
  const times = t.map(function (x) { return Date.parse(x.block_timestamp); }).filter(function (v) { return v > 0; });
  return { n: t.length, wallets: ws.length, top3: Math.round(100 * (sizes[0] + (sizes[1] || 0) + (sizes[2] || 0)) / tot), rt: Math.round(100 * rt / tot),
    mins: times.length ? Math.round((Math.max.apply(null, times) - Math.min.apply(null, times)) / 60000) : null };
}

// The signal for those stats, or null: {code, s, data}
export function washSignal(st) {
  if (!st || st.n < WASH_MIN_TRADES || st.rt < WASH_ROUND_TRIP) return null;
  const few = st.wallets <= WASH_FEW_WALLETS && st.top3 >= WASH_TOP3;
  return { code: "MKT_FAKE_VOLUME", s: few ? "bad" : "warn", data: { rt: st.rt, wallets: st.wallets, trades: st.n, top3: st.top3, few: few } };
}

export async function washTrades(client, pair) {
  if (!pair || !pair.pairAddress) return null;
  const j = await client.softJson(GECKO + "pools/" + pair.pairAddress + "/trades", 6000);
  return washStats(((j && j.data) || []).map(function (x) { return x && x.attributes; }));
}

/* ---------- GeckoTerminal: fills two DexScreener gaps on Pump.fun ---------- */
// Both are optional extras: on any failure the market stays exactly as DexScreener gave it.

// DexScreener reports $0 liquidity for tokens still on Pump.fun's bonding curve. GeckoTerminal has the
// real figure for the same pool (its pool address is DexScreener's pairAddress). Mutates the pair.
export async function geckoLiquidity(client, pair) {
  if (!pair || (pair.liquidity && pair.liquidity.usd) || !pair.pairAddress) return pair;
  const j = await client.softJson(GECKO + "pools/" + pair.pairAddress, 6000);
  const v = Number(j && j.data && j.data.attributes && j.data.attributes.reserve_in_usd) || 0;
  if (v > 0) pair.liquidity = Object.assign({}, pair.liquidity, { usd: v });
  return pair;
}

// A token seconds old is not on DexScreener yet but is on GeckoTerminal: its most liquid pool, shaped
// like a DexScreener pair (what the engine reads: price, liquidity, volume, age, symbol), or null
export async function geckoPair(client, mint) {
  const j = await client.softJson(GECKO + "tokens/" + mint + "/pools?page=1&include=base_token", 6000);
  const p = j && j.data && j.data[0];
  if (!p || !p.attributes) return null;
  const a = p.attributes, rel = p.relationships || {}, t = ((j.included || [])[0] || {}).attributes || {};
  return {
    pairAddress: a.address, dexId: (rel.dex && rel.dex.data && rel.dex.data.id) || "",
    baseToken: { address: mint, symbol: t.symbol, name: t.name },
    priceUsd: String(a.base_token_price_usd || 0), liquidity: { usd: Number(a.reserve_in_usd) || 0 },
    volume: { h24: Number(a.volume_usd && a.volume_usd.h24) || 0 }, pairCreatedAt: Date.parse(a.pool_created_at) || 0,
    info: { imageUrl: t.image_url && !/missing/.test(t.image_url) ? t.image_url : null }, source: "geckoterminal"
  };
}
