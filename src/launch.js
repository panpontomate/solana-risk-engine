import { PUMP_PROGRAM } from "./constants.js";
import { isCancel } from "./errors.js";
import { pool } from "./util.js";

/**
 * Pump.fun tokens a wallet launched in the last 24 h, read on chain from its latest transactions.
 *
 * Launch farms often pay every launch from one wallet but name a fresh "creator" each time, so
 * RugCheck (which follows the creator) sees one token per creator. The wallet that pays is the first
 * signer of the creation transaction: this counts what else it created.
 *
 * @param [opts.limit=40]  latest transactions to read (each one is a request)
 * @param [opts.now]
 * @returns {n, mints, scanned, more}  more = every transaction read was a launch-day one, there may be more
 */
export async function recentLaunches(client, wallet, opts) {
  opts = opts || {};
  const limit = opts.limit || 40, now = opts.now || Date.now();
  const sigs = (await client.rpc("getSignaturesForAddress", [wallet, { limit: limit }])) || [];
  const day = sigs.filter(function (s) { return !s.err && s.blockTime && now / 1000 - s.blockTime < 86400; });
  const mints = [];
  await pool(day, 4, async function (s) {
    const p = { encoding: "jsonParsed", maxSupportedTransactionVersion: 1, commitment: "confirmed" };
    let tx = null;
    try { tx = await client.rpc("getTransaction", [s.signature, p]); }
    catch (e) {
      if (isCancel(e)) throw e;
      // an older RPC that does not know version 1 transactions yet
      if (!/version|invalid param/i.test(e.message || "")) return;
      p.maxSupportedTransactionVersion = 0;
      try { tx = await client.rpc("getTransaction", [s.signature, p]); } catch (e2) { if (isCancel(e2)) throw e2; return; }
    }
    const meta = tx && tx.meta, keys = tx && tx.transaction && tx.transaction.message && tx.transaction.message.accountKeys;
    if (!meta || !keys) return;
    const pump = keys.some(function (k) { return (k.pubkey || k) === PUMP_PROGRAM; });
    const create = (meta.logMessages || []).some(function (l) { return /^Program log: Instruction: Create(V2)?$/.test(l); });
    if (!pump || !create) return;
    const pre = (meta.preTokenBalances || []).map(function (b) { return b.mint; });
    (meta.postTokenBalances || []).forEach(function (b) {
      if (pre.indexOf(b.mint) < 0 && mints.indexOf(b.mint) < 0) mints.push(b.mint);
    });
  });
  return { n: mints.length, mints: mints, scanned: day.length, more: sigs.length >= limit && day.length === sigs.length };
}
