import { ADDRESS_RE, TOKEN_PROGRAM, TOKEN_2022, RUGCHECK } from "./constants.js";
import { ScanError, isCancel } from "./errors.js";
import { pool, progress, uniq } from "./util.js";
import { holderBase, EXCHANGE_PER_HOUR, perHour, sourceRates, onlyReceives } from "./holders.js";
export { EXCHANGE_PER_HOUR, perHour, sourceRates };
import { accountKinds } from "./tokens.js";
import { rugcheckReport } from "./rugcheck.js";

/* ---------- connection map ----------
   Everything around a token at once: its largest holders, what kind of wallet each one is, who gave each
   one its first SOL (holders sharing that source are probably one owner), and the token-transfer networks
   RugCheck keeps (one wallet handing tokens to many). Young tokens (under 14 days) are read for the team's
   split; mature ones for what stayed hidden, with exchanges and pools set aside. */

// Same rule as markBusy: 200 transactions within 2 days is a bot or trader, not a holder sitting on tokens
export const BOT_PER_HOUR = 200 / 48;
export const YOUNG_DAYS = 14;
export const MAP_GROUP_YOUNG = 10, MAP_GROUP_MATURE = 15, MAP_HUB = 20, MAP_WHALE = 10;
// Many holders funded by one wallet warn whatever they hold together: with only the top 20 read the share
// is cut short (1/11, Leverhedge: 19 of the top 20 with 0.4% each from one source, 8.1% in view)
export const MAP_SWARM = 10;
export const MAP_MAX_FREE = 20, MAP_MAX_OWN = 75;

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function b58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; s = "1" + s; }
  return s;
}
function b64bytes(s) {
  if (typeof atob === "function") { const t = atob(s), out = new Uint8Array(t.length); for (let i = 0; i < t.length; i++) out[i] = t.charCodeAt(i); return out; }
  return Uint8Array.from(Buffer.from(s, "base64"));
}


// person | bot | exchange | pool
export function walletType(kind, rate) {
  if (kind === "program") return "pool";
  if (rate > EXCHANGE_PER_HOUR) return "exchange";
  if (rate > BOT_PER_HOUR || kind === "active") return "bot";
  return "person";
}

// walletType, but a busy wallet that signed none of the sampled transactions only RECEIVES (fee shares,
// airdrops, dust): it is a person who gets paid, not a bot or an exchange (same rule as markBusy, 0.4.7).
// Returns { type, passive }.
export async function mapType(client, addr, kind, rate, sigs) {
  const type = walletType(kind, rate);
  if ((type === "bot" || type === "exchange") && kind !== "active" && sigs && sigs.length >= 2 &&
      await onlyReceives(client, addr, sigs)) return { type: "person", passive: true };
  return { type: type, passive: false };
}

// Every token account of the mint (own RPC only), summed by owner, largest first. Reads just the owner
// and amount of each account. Returns null when the RPC refuses or the token is too big to list.
export async function allHolders(client, mint, program, max) {
  const filters = [{ memcmp: { offset: 0, bytes: mint } }];
  if (program === TOKEN_PROGRAM) filters.push({ dataSize: 165 });
  let res;
  try { res = await client.rpc("getProgramAccounts", [program, { encoding: "base64", dataSlice: { offset: 32, length: 40 }, filters: filters }]); }
  catch (e) { if (isCancel(e)) throw e; return null; }
  if (!Array.isArray(res)) return null;
  const by = {};
  res.forEach(function (a) {
    const d = a && a.account && a.account.data;
    const raw = d && b64bytes(Array.isArray(d) ? d[0] : d);
    if (!raw || raw.length < 40) return;
    const owner = b58encode(raw.slice(0, 32));
    let amt = 0n;
    for (let i = 39; i >= 32; i--) amt = amt * 256n + BigInt(raw[i]);
    if (amt > 0n) by[owner] = (by[owner] || 0n) + amt;
  });
  return Object.keys(by).sort(function (a, b) { return by[b] > by[a] ? 1 : by[b] < by[a] ? -1 : 0; })
    .slice(0, max).map(function (o) { return { owner: o, raw: Number(by[o]) }; });
}

// Up to 3 pages of signatures: the oldest one and the newest page (for the rate). first = null when the
// wallet has more than 3000 (its first transaction is too far back to find cheaply).
async function history(client, addr, pages) {
  let before = null, first = null, top = null;
  for (let i = 0; i < pages; i++) {
    const page = await client.rpc("getSignaturesForAddress", [addr, before ? { limit: 1000, before: before } : { limit: 1000 }]);
    if (!page || !page.length) break;
    if (!top) top = page;
    if (page.length < 1000) { first = page[page.length - 1].signature; break; }
    before = page[page.length - 1].signature;
  }
  return { rate: perHour(top), n: top ? top.length : 0, first: first, top: top };
}
// Fee payer (account 0) of a transaction
async function payerOf(client, sig) {
  let tx;
  try { tx = await client.rpc("getTransaction", [sig, { maxSupportedTransactionVersion: 1, encoding: "jsonParsed" }]); }
  catch (e) {
    if (isCancel(e) || !/version|invalid param/i.test(e.message || "")) throw e;
    tx = await client.rpc("getTransaction", [sig, { maxSupportedTransactionVersion: 0, encoding: "jsonParsed" }]);
  }
  const keys = tx && tx.transaction && tx.transaction.message && tx.transaction.message.accountKeys;
  const k = keys && keys[0];
  return k ? (k.pubkey !== undefined ? k.pubkey : k) : null;
}


// RugCheck's token-transfer networks with their links (who handed tokens to whom)
export async function transferNetworks(client, mint, supply) {
  const g = await client.softJson(RUGCHECK + mint + "/insiders/graph", 8000);
  if (!Array.isArray(g)) return [];
  return g.map(function (n) {
    const nodes = (n.nodes || []).filter(function (x) { return x && ADDRESS_RE.test(x.id || ""); })
      .map(function (x) { return { addr: x.id, pct: supply > 0 ? Number(x.holdings || 0) / supply * 100 : 0 }; });
    const links = (n.links || []).filter(function (l) { return l && l.source && l.target; }).map(function (l) { return [l.source, l.target]; });
    return { type: n.network_type || "transfer", nodes: nodes, links: links };
  }).filter(function (n) { return n.nodes.length > 1; }).sort(function (a, b) { return b.nodes.length - a.nodes.length; });
}

// Wallet in the networks that handed tokens to the most others
export function topHub(nets) {
  let best = null;
  nets.forEach(function (n) {
    const out = {};
    n.links.forEach(function (l) { out[l[0]] = (out[l[0]] || 0) + 1; });
    Object.keys(out).forEach(function (a) { if (!best || out[a] > best.out) best = { addr: a, out: out[a] }; });
  });
  return best;
}

// Groups: sources that gave the first SOL to 2+ holders and are not exchanges. In mature tokens only
// people count (bots there are traders who came later, not the team's split).
export function mapGroups(holders, sources, mode) {
  const by = {};
  holders.forEach(function (h) {
    if (!h.funder) return;
    if (mode === "mature" && h.type !== "person") return;
    const s = sources[h.funder];
    if (!s || s.type === "exchange") return;
    (by[h.funder] = by[h.funder] || []).push(h);
  });
  const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return Object.keys(by).filter(function (f) { return by[f].length >= 2; }).map(function (f) {
    return { funder: f, members: by[f].map(function (h) { return h.addr; }), pct: by[f].reduce(function (s, h) { return s + h.pct; }, 0), rate: sources[f].rate };
  }).sort(function (a, b) { return b.pct - a.pct; }).map(function (g, i) { g.id = LETTERS[i] || "G" + i; return g; });
}

export function mapSignals(m) {
  const out = [], young = m.mode === "young", big = m.groups[0];
  const gLimit = young ? MAP_GROUP_YOUNG : MAP_GROUP_MATURE;
  const grouped = big && big.pct > gLimit;
  if (grouped) out.push({ code: "MAP_GROUP", s: young ? "bad" : "warn", data: { n: big.members.length, pct: big.pct, funder: big.funder } });
  // the group with most wallets, unless it is the one MAP_GROUP already named
  const many = m.groups.slice().sort(function (a, b) { return b.members.length - a.members.length || b.pct - a.pct; })[0];
  if (many && many.members.length >= MAP_SWARM && !(grouped && many === big))
    out.push({ code: "MAP_SWARM", s: young ? "bad" : "warn", data: { n: many.members.length, of: (m.holders || []).length, pct: many.pct, funder: many.funder } });
  if (young && m.hub && m.hub.out >= MAP_HUB) out.push({ code: "MAP_HUB", s: "bad", data: { n: m.hub.out, addr: m.hub.addr } });
  if (!young) {
    const w = m.holders.filter(function (h) { return h.type === "person" && h.pct > MAP_WHALE; }).sort(function (a, b) { return b.pct - a.pct; })[0];
    if (w) out.push({ code: "MAP_WHALE", s: "warn", data: { pct: w.pct, addr: w.addr } });
  }
  return out;
}

/**
 * Connection map of a token.
 * @param [opts.createdAt]  ms when its market started (DexScreener pairCreatedAt); without it RugCheck's detectedAt
 * @param [opts.max]        holders to read (default 20, or 75 with your own RPC)
 * @param [opts.now]
 * @returns {mint, mode, ageDays, supply, holders: [{addr, pct, type, rate, funder}], sources: {addr: {rate, type, n}},
 *           groups, nets, hub, creator, payer, signals}
 */
export async function connectionMap(client, mint, opts) {
  opts = opts || {};
  const onProgress = opts.onProgress, now = opts.now || Date.now();
  if (!ADDRESS_RE.test(mint || "")) throw new ScanError("INVALID_ADDRESS", "not a Solana address");
  const own = client.ownRpc(), max = opts.max || (own ? MAP_MAX_OWN : MAP_MAX_FREE);

  // 1) holders: with your own RPC, every account of the token (up to max); otherwise the RPC's top 20
  const b = await holderBase(client, mint, onProgress);
  const supply = Number(b.info.supply) || 0;
  let rows = null;
  if (own && max > 20) {
    const prog = b.info.program === TOKEN_2022 ? TOKEN_2022 : TOKEN_PROGRAM;
    rows = await allHolders(client, mint, prog, max);
  }
  let kind = b.kind;
  if (rows && rows.length) {
    const missing = rows.map(function (r) { return r.owner; }).filter(function (o) { return !kind[o]; });
    if (missing.length) kind = Object.assign({}, kind, await accountKinds(client, missing, true));
  } else {
    const agg = {};
    b.largest.forEach(function (a, i) { const o = b.owners[i] || a.address; agg[o] = (agg[o] || 0) + Number(a.amount); });
    rows = Object.keys(agg).map(function (o) { return { owner: o, raw: agg[o] }; }).sort(function (x, y) { return y.raw - x.raw; });
  }

  // 2) age and mode
  const rc = await rugcheckReport(client, mint);
  const created = opts.createdAt || (rc && rc.detectedAt ? Date.parse(rc.detectedAt) : null);
  const ageDays = created ? (now - created) / 86400000 : null;
  const mode = ageDays !== null && ageDays < YOUNG_DAYS ? "young" : "mature";

  // 3) each holder: how busy it is and who paid its first transaction
  const holders = rows.map(function (r) { return { addr: r.owner, pct: supply > 0 ? r.raw / supply * 100 : 0, kind: kind[r.owner] || "program" }; });
  let done = 0;
  await pool(holders, 3, async function (h) {
    try {
      if (h.kind !== "program") {
        const hs = await history(client, h.addr, mode === "young" ? 3 : 1);
        h.rate = hs.rate;
        const t = await mapType(client, h.addr, h.kind, hs.rate, hs.top);
        h.type = t.type; if (t.passive) h.passive = true;
        // in mature tokens only people are traced; exchanges never (they would join strangers)
        let first = hs.first;
        if (!first && mode === "mature" && h.type === "person" && hs.n >= 1000) first = (await history(client, h.addr, 3)).first;
        if (first && h.type !== "exchange" && (mode === "young" || h.type === "person")) {
          const p = await payerOf(client, first);
          if (p && p !== h.addr) h.funder = p;
        }
      } else { h.type = "pool"; h.rate = 0; }
    } catch (e) { if (isCancel(e)) throw e; h.type = h.type || walletType(h.kind, 0); }
    delete h.kind;
    done++; progress(onProgress, "funders", 0.45 + 0.35 * done / holders.length, { done: done, total: holders.length });
  });

  // 4) the sources: exchanges or not
  const srcList = uniq(holders.map(function (h) { return h.funder; }).filter(Boolean));
  const rates = await sourceRates(client, srcList, function (c, n) { progress(onProgress, "exchangeSources", 0.8 + 0.08 * c / Math.max(1, n), { done: c, total: n }); });
  const sources = {};
  srcList.forEach(function (s) {
    sources[s] = { rate: rates[s] || 0, type: (rates[s] || 0) > EXCHANGE_PER_HOUR ? "exchange" : "person",
      n: holders.filter(function (h) { return h.funder === s; }).length };
  });

  // 5) transfer networks, creator and who paid the launch (young tokens)
  progress(onProgress, "networks", 0.9);
  const nets = await transferNetworks(client, mint, supply);
  let payer = null;
  if (mode === "young") {
    try { const mh = await history(client, mint, 3); if (mh.first) payer = await payerOf(client, mh.first); }
    catch (e) { if (isCancel(e)) throw e; }
  }
  const m = {
    mint: mint, mode: mode, ageDays: ageDays, supply: supply, holders: holders, sources: sources,
    groups: mapGroups(holders, sources, mode), nets: nets, hub: topHub(nets),
    creator: (rc && rc.creator) || null, payer: payer
  };
  m.signals = mapSignals(m);
  progress(onProgress, "done", 1);
  return m;
}
