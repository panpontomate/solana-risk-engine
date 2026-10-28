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

// Exchanges and launch platforms move thousands of transactions an hour; the busiest farms and
// distributors seen in the 28/10 study did 1-150. Above this, a wallet is infrastructure, not a person.
export const EXCHANGE_PER_HOUR = 350;
// Young tokens (under 14 days) are read for the team's split, mature ones for what stayed hidden
export const YOUNG_DAYS = 14;
// A group (holders sharing the source of their first SOL) over this % of the supply warns
export const HOLD_GROUP_YOUNG = 10, HOLD_GROUP_MATURE = 15;

// Transactions per hour over a page of signatures (newest first)
export function perHour(sigs) {
  if (!sigs || sigs.length < 2) return 0;
  const span = ((sigs[0].blockTime || 0) - (sigs[sigs.length - 1].blockTime || 0)) / 3600;
  return span > 0 ? sigs.length / span : sigs.length * 3600;
}

// Rate of each source wallet (one request each)
export async function sourceRates(client, addrs, onStep) {
  const out = {};
  let done = 0;
  await pool(addrs, 3, async function (a) {
    try { out[a] = perHour(await client.rpc("getSignaturesForAddress", [a, { limit: 1000 }])); }
    catch (e) { if (isCancel(e)) throw e; out[a] = null; }
    done++; if (onStep) onStep(done, addrs.length);
  });
  return out;
}

// Groups by size of their share of the supply, biggest first: [{id, funder, members, pct}]
export function groupList(clusters, rows) {
  const by = {};
  rows.forEach(function (r) {
    const c = clusters[r.owner]; if (!c) return;
    const g = by[c.id] || (by[c.id] = { id: c.id, funder: c.funder, members: [], pct: 0 });
    g.members.push(r.owner); g.pct += r.pct;
  });
  return Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.pct - a.pct; });
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
 * Young tokens (under 14 days: market age from DexScreener, else RugCheck's detectedAt) also trace the
 * busy wallets: on day one most big holders trade a lot and the team's split hides among them. A group
 * over 10% of the supply in a young token (bad) or 15% in a mature one (warn) is a HOLD_GROUP signal.
 *
 * @param [opts.creator=true]  also look up the creator and insider networks on RugCheck
 * @param [opts.createdAt]     ms when its market started, if the caller knows it
 * @param [opts.now]
 * @returns {..., mode: "young"|"mature", ageDays, groups, signals}
 */
export async function analyzeHolders(client, mint, opts) {
  opts = opts || {};
  const onProgress = opts.onProgress;
  if (!ADDRESS_RE.test(mint || "")) throw new ScanError("INVALID_ADDRESS", "not a Solana address");
  const b = await holderBase(client, mint, onProgress);
  const wal = b.uniq.filter(function (o) { return b.kind[o] === "wallet"; });
  const busy = await markBusy(client, b.kind, wal, function (c, n) { progress(onProgress, "bots", 0.65 + 0.15 * c / Math.max(1, n), { done: c, total: n }); });
  const hr = holderRows(b, busy), pair = b.pair;
  const now = opts.now || Date.now();
  let created = opts.createdAt || (pair && pair.pairCreatedAt) || null;
  if (!created) {
    const rc = await rugcheckReport(client, mint);
    if (rc && rc.detectedAt) created = Date.parse(rc.detectedAt) || null;
  }
  const ageDays = created ? Math.max(0, (now - created) / 86400000) : null;
  const mode = ageDays !== null && ageDays < YOUNG_DAYS ? "young" : "mature";
  // who is traced: people always; in young tokens also the busy wallets
  const traced = hr.rows.filter(function (r) { return r.kind === "wallet" || (mode === "young" && r.kind === "active"); })
    .map(function (r) { return r.owner; });
  let clusters = {}, hotGroups = 0;
  if (traced.length >= 2) {
    const funders = await findFunders(client, traced, function (c, n) { progress(onProgress, "funders", 0.8 + 0.08 * c / Math.max(1, n), { done: c, total: n }); });
    clusters = clusterByFunder(funders);
    const srcs = uniq(Object.keys(clusters).map(function (a) { return clusters[a].funder; }));
    if (srcs.length) {
      // a source is an exchange when it moves more than EXCHANGE_PER_HOUR transactions an hour (the bot
      // test, 200 in 2 days, also caught distributors doing ~50 an hour and hid their groups)
      const rates = await sourceRates(client, srcs, function (c, n) { progress(onProgress, "exchangeSources", 0.88 + 0.02 * c / Math.max(1, n), { done: c, total: n }); });
      const hot = {};
      srcs.forEach(function (f) { if (rates[f] > EXCHANGE_PER_HOUR) hot[f] = true; });
      hotGroups = srcs.filter(function (f) { return hot[f]; }).length;
      if (hotGroups) clusters = clusterByFunder(funders, hot);
    }
  }
  const groups = groupList(clusters, hr.rows), signals = [];
  const limit = mode === "young" ? HOLD_GROUP_YOUNG : HOLD_GROUP_MATURE;
  if (groups[0] && groups[0].pct > limit)
    signals.push({ code: "HOLD_GROUP", s: mode === "young" ? "bad" : "warn", data: { n: groups[0].members.length, pct: groups[0].pct, id: groups[0].id, funder: groups[0].funder } });
  let creator = null;
  if (opts.creator !== false) {
    progress(onProgress, "creator", 0.9);
    creator = await creatorInfo(client, mint, onProgress);
  }
  progress(onProgress, "done", 1);
  return {
    mint: mint, sym: (pair && pair.baseToken && pair.baseToken.symbol) || short(mint),
    name: (pair && pair.baseToken && pair.baseToken.name) || "", price: hr.price, rows: hr.rows,
    mintAuth: !!b.info.mintAuth, freezeAuth: !!b.info.freezeAuth, clusters: clusters, hotGroups: hotGroups, creator: creator,
    mode: mode, ageDays: ageDays, groups: groups, signals: signals
  };
}
