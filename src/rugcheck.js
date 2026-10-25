import { RUGCHECK } from "./constants.js";
import { isCancel } from "./errors.js";
import { kindOf } from "./tokens.js";
import { pool } from "./util.js";

// Extra signal from RugCheck.xyz (public API, no key): mainly the % of liquidity locked or burned,
// which on-chain data does not show without decoding each DEX's binary layout (Raydium, Orca, Meteora
// and pump.fun all differ). It is an extra, never a requirement: on failure these return null and the
// rest of the analysis is exactly the same.
export function rugcheckSummary(client, mint) {
  return client.softJson(RUGCHECK + mint + "/report/summary", 6000);
}

// Full report (~700 KB, so ask once per holder search, never per token of a wallet): who created the
// token, which other tokens that wallet created and whether RugCheck sees wallet networks linked by
// transfers (a wider coordination signal than a shared funder).
export function rugcheckReport(client, mint) {
  return client.softJson(RUGCHECK + mint + "/report", 10000);
}

// The report only gives each network's size; this endpoint gives its wallets and holdings
export async function rugcheckGraph(client, mint) {
  const g = await client.softJson(RUGCHECK + mint + "/insiders/graph", 8000);
  if (!Array.isArray(g)) return null;
  return g.map(function (n) {
    const nodes = (n.nodes || []).filter(function (x) { return x && x.id && x.participant !== false; })
      .map(function (x) { return { addr: x.id, hold: Number(x.holdings || 0) }; })
      .sort(function (a, b) { return b.hold - a.hold; });
    return { nodes: nodes, hold: nodes.reduce(function (s, x) { return s + x.hold; }, 0) };
  }).filter(function (n) { return n.nodes.length > 1; }).sort(function (a, b) { return b.hold - a.hold; });
}

// The graph's "holdings" are not today's balance: a wallet that handed tokens out shows the whole
// network's total even with 0, and sometimes a network includes a pool. This reads on chain what each
// one holds today and whether it is a wallet or a program. Mutates the graph (adds now/kind/checked).
export async function netBalances(client, mint, graph) {
  let addrs = [];
  graph.forEach(function (n) { n.nodes.forEach(function (x) { if (addrs.indexOf(x.addr) < 0) addrs.push(x.addr); }); });
  addrs = addrs.slice(0, client.ownRpc() ? 80 : 25);   // without your own URL each balance goes through the ~1/s queue
  const bal = {}, kind = {};
  for (let i = 0; i < addrs.length; i += 100) {
    const part = addrs.slice(i, i + 100);
    try {
      const oa = await client.rpc("getMultipleAccounts", [part, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }]);
      part.forEach(function (a, k) { kind[a] = kindOf(a, oa.value[k], true); });
    } catch (e) { if (isCancel(e)) throw e; }
  }
  await pool(addrs, 4, async function (a) {
    try {
      const r = await client.rpc("getTokenAccountsByOwner", [a, { mint: mint }, { encoding: "jsonParsed" }]);
      bal[a] = (r && r.value || []).reduce(function (s, c) { return s + Number(c.account.data.parsed.info.tokenAmount.amount || 0); }, 0);
    } catch (e) { if (isCancel(e)) throw e; }
  });
  graph.forEach(function (n) {
    n.checked = true; n.now = 0;
    n.nodes.forEach(function (x) {
      x.kind = kind[x.addr] || null;
      x.now = bal[x.addr] === undefined ? null : bal[x.addr];
      if (x.now === null) n.checked = false;
      else if (x.kind !== "program") n.now += x.now;   // what sits in a pool belongs to nobody in the network
    });
    n.nodes.sort(function (a, b) { return (b.now || 0) - (a.now || 0) || b.hold - a.hold; });
  });
  graph.sort(function (a, b) { return b.now - a.now || b.hold - a.hold; });
  return graph;
}
