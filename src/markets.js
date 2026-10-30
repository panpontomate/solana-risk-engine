import { DEX, DEX_SEARCH, GECKO, USDC, USDT, WSOL, FAMOUS, BRANDS, brandKey, BRAND_MATURE_DAYS, BRAND_MATURE_LIQ } from "./constants.js";
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

// Other Solana tokens with the same name and symbol (DexScreener search). The oldest one is taken as
// the original. Returns null when this token is the oldest or nothing else matches.
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
  const oldest = others.filter(function (o) { return o.at; }).sort(function (x, y) { return x.at - y.at; })[0];
  // this token is itself the oldest (or the dates are unknown): it is the original, the others copy it
  if (!oldest || (mine.at && mine.at <= oldest.at)) return null;
  return { n: others.length, original: oldest.addr, days: Math.floor(((now || Date.now()) - oldest.at) / 86400000), origLiq: oldest.liq, liq: mine.liq };
}

// Best (most liquid) DexScreener pair per mint, 30 mints per request.
// `failed` lists mints whose batch failed: unknown, which is not the same as "no market".
export async function getMarkets(client, mints, onStep) {
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
