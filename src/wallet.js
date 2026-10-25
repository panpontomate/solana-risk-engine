import { ADDRESS_RE, KNOWN, LEVELS } from "./constants.js";
import { ScanError } from "./errors.js";
import { pool, progress } from "./util.js";
import { getTokens, isMint } from "./tokens.js";
import { getMarkets } from "./markets.js";
import { assess } from "./risk.js";

function checkAddress(addr) {
  if (!ADDRESS_RE.test(addr || "")) throw new ScanError("INVALID_ADDRESS", "not a Solana address");
}

export function sortResults(list) {
  return list.sort(function (a, b) {
    return LEVELS.indexOf(a.lvl) - LEVELS.indexOf(b.lvl) || (b.sev || 0) - (a.sev || 0) || b.pts - a.pts || b.value - a.value;
  });
}

/** Risk of a single token. Throws IS_NFT for NFTs. */
export async function analyzeToken(client, mint, opts) {
  opts = opts || {};
  checkAddress(mint);
  progress(opts.onProgress, "markets", 0.15);
  const mkr = await getMarkets(client, [mint]);
  progress(opts.onProgress, "token", 0.45);
  const r = await assess(client, mint, mkr.data[mint] || null, { marketUnknown: mkr.failed.length > 0, skipConcentration: opts.skipConcentration, skipCreator: opts.skipCreator });
  if (!r) throw new ScanError("IS_NFT", "that address is an NFT, not a token");
  progress(opts.onProgress, "done", 1);
  return r;
}

/**
 * Risk of every token a wallet holds.
 *
 * @param [opts.minUsd=1]      hide priced tokens worth less than this (dust)
 * @param [opts.concurrency=3]
 * @returns {wallet, sol, balances, total, hidden, results}
 */
export async function analyzeWallet(client, wallet, opts) {
  opts = opts || {};
  checkAddress(wallet);
  const minUsd = opts.minUsd === undefined ? 1 : opts.minUsd;
  const onProgress = opts.onProgress;
  progress(onProgress, "wallet", 0.02);
  const w = await getTokens(client, wallet);
  const mints = Object.keys(w.tokens);
  const res = { wallet: wallet, sol: w.sol, balances: w.tokens, total: mints.length, hidden: 0, results: [] };
  if (!mints.length) return res;
  progress(onProgress, "markets", 0.08);
  const mkr = await getMarkets(client, mints, function (d, n) { progress(onProgress, "markets", 0.08 + 0.12 * d / n, { done: d, total: n }); });
  const mk = mkr.data, failedMk = {};
  mkr.failed.forEach(function (m) { failedMk[m] = 1; });

  const out = [], todo = [];
  mints.forEach(function (m) {
    const pair = mk[m], price = Number((pair && pair.priceUsd) || 0);
    let value = w.tokens[m] * price;
    if (pair && pair.liqRaw) value = Math.min(value, pair.liquidity.usd);   // with inflated liquidity the price is fake too
    if (KNOWN[m]) { out.push({ mint: m, sym: KNOWN[m], name: "", pts: 0, sev: 0, lvl: "LOW", known: true, type: null, lights: null, reasons: [{ code: "KNOWN_TOKEN", s: "ok" }], value: value, pair: pair, img: null }); return; }
    if (price > 0 && value < minUsd) { res.hidden++; return; }
    todo.push({ mint: m, pair: pair, value: value, unknown: !!failedMk[m] });
  });

  let done = 0;
  await pool(todo, opts.concurrency || 3, async function (t) {
    const r = await assess(client, t.mint, t.pair, { value: t.value, marketUnknown: t.unknown, skipConcentration: opts.skipConcentration, skipCreator: opts.skipCreator });
    if (r) out.push(r);
    done++;
    progress(onProgress, "tokens", 0.2 + 0.8 * done / Math.max(1, todo.length), { done: done, total: todo.length });
  });
  res.results = sortResults(out);
  return res;
}

/** Detects whether the address is a token mint or a wallet and analyses it accordingly. */
export async function analyzeAddress(client, addr, opts) {
  checkAddress(addr);
  progress(opts && opts.onProgress, "address", 0.01);
  if (await isMint(client, addr)) return { kind: "token", token: await analyzeToken(client, addr, opts) };
  return { kind: "wallet", wallet: await analyzeWallet(client, addr, opts) };
}
