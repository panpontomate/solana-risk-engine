import { ADDRESS_RE } from "./constants.js";
import { ScanError, isCancel } from "./errors.js";
import { pool, progress, short, uniq } from "./util.js";
import { getMint, accountKinds } from "./tokens.js";
import { getMarkets } from "./markets.js";
import { rugcheckReport, rugcheckGraph, rugcheckSummary, netBalances } from "./rugcheck.js";

// Largest accounts of a token, each traced to its owner, and whether each owner is a wallet or a program
export async function holderBase(client, mint, onProgress) {
  progress(onProgress, "token", 0.08);
  const res = await Promise.all([
    getMint(client, mint),
    client.rpc("getTokenLargestAccounts", [mint]),
    getMarkets(client, [mint]).catch(function (e) { if (isCancel(e)) throw e; return { data: {}, failed: [mint] }; })
  ]);
  const info = res[0], largest = (res[1] && res[1].value) || [], pair = res[2].data[mint] || null;
  if (!info) throw new ScanError("NOT_A_TOKEN", "that address is not a token");
  if (!largest.length) throw new ScanError("NO_HOLDERS", "the RPC returned no holder data");
  progress(onProgress, "owners", 0.4);
  const ta = await client.rpc("getMultipleAccounts", [largest.map(function (a) { return a.address; }), { encoding: "jsonParsed" }]);
  const owners = ta.value.map(function (v) {
    return v && v.data && v.data.parsed && v.data.parsed.info && v.data.parsed.info.owner || null;
  });
  const owned = uniq(owners.filter(Boolean));
  progress(onProgress, "kinds", 0.7);
  const kind = await accountKinds(client, owned, false);
  return { mint: mint, info: info, pair: pair, largest: largest, owners: owners, uniq: owned, kind: kind };
}

// People's wallets rarely move hundreds of transactions in a couple of days; exchanges, bots and
// market makers do. Checked with the last 200 signatures. Marks them kind[o] = "active" (mutates kind)
// and returns {address: hours it took to do those 200}.
export async function markBusy(client, kind, wallets, onStep) {
  const busy = {};
  let chk = 0;
  await pool(wallets, 3, async function (o) {
    try {
      const sg = await client.rpc("getSignaturesForAddress", [o, { limit: 200 }]);
      if (sg && sg.length >= 200) {
        const t1 = sg[0].blockTime, t0 = sg[sg.length - 1].blockTime;
        if (t1 && t0 && (t1 - t0) < 2 * 86400) { kind[o] = "active"; busy[o] = Math.max(1, Math.round((t1 - t0) / 3600)); }
      }
    } catch (e) { if (isCancel(e)) throw e; }
    chk++; if (onStep) onStep(chk, wallets.length);
  });
  return busy;
}

/* ---------- wallets funded from the same source (maybe one owner split into several accounts) ---------- */
// By Solana protocol, account 0 of any transaction is always the fee payer. Looking at who paid the
// very first transaction of each wallet shows who "created" it with the first SOL transfer. If several
// wallets that look like different holders share that source, they are most likely the same person or
// team splitting the supply to look decentralised. If the wallet is too active to find its first
// transaction reliably (more than 3000 signatures), it is left without data rather than guessing wrong.
export async function findFunder(client, addr) {
  try {
    let sigs = null, before = null, reachedEnd = false;
    for (let i = 0; i < 3; i++) {
      const page = await client.rpc("getSignaturesForAddress", [addr, before ? { limit: 1000, before: before } : { limit: 1000 }]);
      if (!page || !page.length) { reachedEnd = true; break; }
      sigs = page;
      if (page.length < 1000) { reachedEnd = true; break; }
      before = page[page.length - 1].signature;
    }
    if (!reachedEnd || !sigs || !sigs.length) return null;
    const earliest = sigs[sigs.length - 1].signature;
    // version 1 is needed for recent transactions; an older RPC that does not know it yet gets 0
    let tx;
    try { tx = await client.rpc("getTransaction", [earliest, { maxSupportedTransactionVersion: 1, encoding: "jsonParsed" }]); }
    catch (e) {
      if (isCancel(e) || !/version|invalid param/i.test(e.message || "")) throw e;
      tx = await client.rpc("getTransaction", [earliest, { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" }]);
    }
    const keys = tx && tx.transaction && tx.transaction.message && tx.transaction.message.accountKeys;
    if (!keys || !keys.length) return null;
    const payer = keys[0] && (keys[0].pubkey !== undefined ? keys[0].pubkey : keys[0]);
    if (!payer || payer === addr) return null;   // it paid for itself: there is no outside source to look at
    return payer;
  } catch (e) { if (isCancel(e)) throw e; return null; }
}

export async function findFunders(client, wallets, onStep) {
  const out = {};
  let done = 0;
  await pool(wallets, 3, async function (a) {
    out[a] = await findFunder(client, a);
    done++; if (onStep) onStep(done, wallets.length);
  });
  return out;
}

// An exchange pays the withdrawals of thousands of customers from the same wallet: if that is the
// source, the "group" joins strangers. So sources that pass the same very-active test used to separate
// bots are ignored (hot = markBusy result over the sources).
export function clusterByFunder(funders, hot) {
  const byFunder = {};
  Object.keys(funders).forEach(function (a) {
    const f = funders[a]; if (!f || (hot && hot[f])) return;
    (byFunder[f] = byFunder[f] || []).push(a);
  });
  const clusters = {}, LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let n = 0;
  Object.keys(byFunder).forEach(function (f) {
    const ws = byFunder[f];
    if (ws.length < 2) return;   // a single wallet with that source is not a pattern
    const id = LETTERS[n] || ("G" + n); n++;
    ws.forEach(function (a) { clusters[a] = { id: id, n: ws.length, funder: f }; });
  });
  return clusters;
}

// One row per owner (several token accounts of the same owner are summed), sorted by % of supply
export function holderRows(b, busy) {
  busy = busy || {};
  const agg = {};
  b.largest.forEach(function (a, i) {
    const o = b.owners[i] || a.address;
    if (!agg[o]) agg[o] = { owner: o, kind: b.kind[o] || "program", raw: 0, busy: busy[o] || 0 };
    agg[o].raw += Number(a.amount);
  });
  const price = Number((b.pair && b.pair.priceUsd) || 0);
  const rows = Object.keys(agg).map(function (k) {
    const r = agg[k];
    r.pct = b.info.supply > 0 ? r.raw / b.info.supply * 100 : 0;
    r.tokens = r.raw / Math.pow(10, b.info.decimals);
    r.value = r.tokens * price;
    return r;
  }).sort(function (a, c) { return c.pct - a.pct; });
  rows.forEach(function (r, i) { r.rank = i + 1; });
  return { rows: rows, price: price };
}

// Who created the token, what else they created (and how risky it is) and RugCheck's insider networks
export async function creatorInfo(client, mint, onProgress) {
  try {
    const rcs = await Promise.all([rugcheckReport(client, mint), rugcheckGraph(client, mint)]), rc = rcs[0];
    if (!rc || !rc.creator) return null;
    const others = (rc.creatorTokens || []).filter(function (t) { return t.mint !== mint; })
      .sort(function (a, b) { return new Date(b.createdAt || 0) - new Date(a.createdAt || 0); });
    const toCheck = others.slice(0, 10), riskMap = {};
    if (toCheck.length) {
      progress(onProgress, "creatorTokens", 0.94);
      await pool(toCheck, 3, async function (t) { riskMap[t.mint] = await rugcheckSummary(client, t.mint); });
    }
    const creator = {
      addr: rc.creator, balance: rc.creatorBalance || 0, rugged: !!rc.rugged,
      launchpad: (rc.launchpad && rc.launchpad.name) || null, others: others, checked: toCheck.length,
      riskMap: riskMap, insiderNetworks: rc.insiderNetworks || [], graph: rcs[1], supply: (rc.token && rc.token.supply) || 0
    };
    if (creator.graph && creator.graph.length) {
      progress(onProgress, "networks", 0.97);
      await netBalances(client, mint, creator.graph);
    }
    return creator;
  } catch (e) { if (isCancel(e)) throw e; return null; }   // like RugCheck in general: never blocks the main result
}

/**
 * Whale finder: top holders, with bots/exchanges separated from people, people grouped by who funded
 * them, and the creator's history. Works best with your own RPC (it needs getTokenLargestAccounts).
 *
 * @param [opts.creator=true]  also look up the creator and insider networks on RugCheck
 */
export async function analyzeHolders(client, mint, opts) {
  opts = opts || {};
  const onProgress = opts.onProgress;
  if (!ADDRESS_RE.test(mint || "")) throw new ScanError("INVALID_ADDRESS", "not a Solana address");
  const b = await holderBase(client, mint, onProgress);
  const wal = b.uniq.filter(function (o) { return b.kind[o] === "wallet"; });
  const busy = await markBusy(client, b.kind, wal, function (c, n) { progress(onProgress, "bots", 0.65 + 0.15 * c / Math.max(1, n), { done: c, total: n }); });
  const hr = holderRows(b, busy), pair = b.pair;
  const people = hr.rows.filter(function (r) { return r.kind === "wallet"; }).map(function (r) { return r.owner; });
  let clusters = {}, hotGroups = 0;
  if (people.length >= 2) {
    const funders = await findFunders(client, people, function (c, n) { progress(onProgress, "funders", 0.8 + 0.08 * c / Math.max(1, n), { done: c, total: n }); });
    clusters = clusterByFunder(funders);
    const srcs = uniq(Object.keys(clusters).map(function (a) { return clusters[a].funder; }));
    if (srcs.length) {
      const hot = await markBusy(client, {}, srcs, function (c, n) { progress(onProgress, "exchangeSources", 0.88 + 0.02 * c / Math.max(1, n), { done: c, total: n }); });
      hotGroups = srcs.filter(function (f) { return hot[f]; }).length;
      if (hotGroups) clusters = clusterByFunder(funders, hot);
    }
  }
  let creator = null;
  if (opts.creator !== false) {
    progress(onProgress, "creator", 0.9);
    creator = await creatorInfo(client, mint, onProgress);
  }
  progress(onProgress, "done", 1);
  return {
    mint: mint, sym: (pair && pair.baseToken && pair.baseToken.symbol) || short(mint),
    name: (pair && pair.baseToken && pair.baseToken.name) || "", price: hr.price, rows: hr.rows,
    mintAuth: !!b.info.mintAuth, freezeAuth: !!b.info.freezeAuth, clusters: clusters, hotGroups: hotGroups, creator: creator
  };
}
