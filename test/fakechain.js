// An in-memory Solana + DexScreener + RugCheck + Helius + CoinGecko, answering through a fake fetch.
// Describe the world declaratively and every engine function can run end to end against it.
import { createHash } from "node:crypto";
import { TOKEN_PROGRAM, TOKEN_2022, SYSTEM_PROGRAM, DEX, RUGCHECK, HELIUS_API, COINGECKO_SOL } from "../src/constants.js";

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export function b58encode(bytes) {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let s = "";
  while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of bytes) { if (b !== 0) break; s = "1" + s; }
  return s;
}

// Deterministic, valid-looking 32-byte address for a label (distinct labels never collide in practice)
export function addr(label) {
  const bytes = [...createHash("sha256").update(label).digest()];
  bytes[0] = bytes[0] || 7;   // never a leading zero byte, so the encoding is 43-44 chars
  return b58encode(bytes);
}

/**
 * world = {
 *   mints:   { [mint]: { mintAuthority, freezeAuthority, supply, decimals, extensions: [names], program } },
 *   largest: { [mint]: [{ address, amount, owner }] }       token accounts (owner = who owns the token account)
 *   owners:  { [address]: programId }                       who owns each account (SYSTEM_PROGRAM = wallet)
 *   wallets: { [wallet]: { sol, tokens: { [mint]: uiAmount } } }
 *   sigs:    { [address]: [{ signature, blockTime }] }      newest first
 *   txs:     { [signature]: payer }
 *   pairs:   [ DexScreener pairs ]
 *   rugcheck:{ [mint]: { summary, report, graph } }
 *   swaps:   { [wallet]: [ Helius parsed txs ] }
 *   solPrices: [[ms, usd]]
 *   fail:    { dex: true | "network", rpc: { method: status } }
 * }
 */
export function fakeChain(world) {
  const w = Object.assign({ mints: {}, largest: {}, owners: {}, wallets: {}, sigs: {}, txs: {}, pairs: [], rugcheck: {}, swaps: {}, fail: {} }, world);
  const tokenAccOwner = {};
  Object.keys(w.largest).forEach((m) => w.largest[m].forEach((a) => { tokenAccOwner[a.address] = a.owner; }));
  const calls = [];

  function rpc(method, p) {
    const status = w.fail.rpc && w.fail.rpc[method];
    if (status) return { __status: status };
    switch (method) {
      case "getAccountInfo": {
        const a = p[0], m = w.mints[a];
        if (m) return { value: { owner: m.program || TOKEN_PROGRAM, data: { parsed: { type: "mint", info: {
          mintAuthority: m.mintAuthority || null, freezeAuthority: m.freezeAuthority || null,
          supply: String(m.supply), decimals: m.decimals, extensions: (m.extensions || []).map((e) => ({ extension: e })) } } } } };
        if (w.owners[a] || w.wallets[a]) return { value: { owner: w.owners[a] || SYSTEM_PROGRAM, data: ["", "base64"] } };
        return { value: null };
      }
      case "getMultipleAccounts":
        return { context: { slot: 1 }, value: p[0].map((a) => {
          if (p[1].encoding === "jsonParsed") return tokenAccOwner[a] ? { data: { parsed: { info: { owner: tokenAccOwner[a] } } } } : null;
          const o = w.owners[a] || (w.wallets[a] ? SYSTEM_PROGRAM : null);
          return o ? { owner: o } : null;
        }) };
      case "getTokenLargestAccounts":
        return { value: (w.largest[p[0]] || []).map((a) => ({ address: a.address, amount: String(a.amount) })) };
      case "getBalance":
        return { value: Math.round(((w.wallets[p[0]] && w.wallets[p[0]].sol) || 0) * 1e9) };
      case "getTokenAccountsByOwner": {
        const wl = w.wallets[p[0]], toks = (wl && wl.tokens) || {};
        const filter = p[1];
        const list = Object.keys(toks).filter((m) => {
          if (filter.mint) return m === filter.mint;
          const prog = (w.mints[m] && w.mints[m].program) || TOKEN_PROGRAM;
          return prog === filter.programId;
        });
        return { value: list.map((m) => {
          const dec = (w.mints[m] && w.mints[m].decimals) || 0;
          return { account: { data: { parsed: { info: { mint: m, tokenAmount: { uiAmount: toks[m], amount: String(Math.round(toks[m] * Math.pow(10, dec))) } } } } } };
        }) };
      }
      case "getSignaturesForAddress": {
        let list = w.sigs[p[0]] || [];
        const o = p[1] || {};
        if (o.before) { const i = list.findIndex((s) => s.signature === o.before); list = i >= 0 ? list.slice(i + 1) : []; }
        return list.slice(0, o.limit || 1000);
      }
      case "getTransaction": {
        const payer = w.txs[p[0]];
        return payer ? { transaction: { message: { accountKeys: [{ pubkey: payer }] } } } : null;
      }
      default:
        return undefined;
    }
  }

  function http(url) {
    if (url.indexOf(DEX) === 0) {
      if (w.fail.dex === "network") throw new TypeError("fetch failed");
      if (w.fail.dex) return { __status: 500 };
      const asked = url.slice(DEX.length).split(",");
      return w.pairs.filter((p) => asked.indexOf(p.baseToken.address) >= 0);
    }
    if (url.indexOf(RUGCHECK) === 0) {
      const rest = url.slice(RUGCHECK.length), mint = rest.split("/")[0], rc = w.rugcheck[mint];
      if (!rc) return { __status: 404 };
      if (rest.endsWith("/report/summary")) return rc.summary || { __status: 404 };
      if (rest.endsWith("/insiders/graph")) return rc.graph || { __status: 404 };
      if (rest.endsWith("/report")) return rc.report || { __status: 404 };
      return { __status: 404 };
    }
    if (url.indexOf(HELIUS_API) === 0) {
      if (w.fail.helius) return { __status: w.fail.helius };
      const wallet = url.slice(HELIUS_API.length).split("/")[0];
      const list = w.swaps[wallet] || [];
      const before = new URL(url).searchParams.get("before");
      const i = before ? list.findIndex((t) => t.signature === before) + 1 : 0;
      return list.slice(i, i + 100);
    }
    if (url === COINGECKO_SOL) return w.solPrices ? { prices: w.solPrices } : { __status: 500 };
    return { __status: 404 };
  }

  async function fetch(url, init) {
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ url: url, method: body && body.method, params: body && body.params });
    const res = body ? rpc(body.method, body.params) : http(url);
    if (res && res.__status) return reply(res.__status, {});
    if (body) return reply(200, res === undefined ? { jsonrpc: "2.0", id: 1, error: { code: -32601, message: "method not found" } } : { jsonrpc: "2.0", id: 1, result: res });
    return reply(200, res);
  }
  fetch.calls = calls;
  fetch.world = w;
  return fetch;
}

function reply(status, json) {
  return { status: status, ok: status >= 200 && status < 300, json: async () => json };
}

// A DexScreener pair
export function pairOf(mint, o) {
  return Object.assign({
    baseToken: { address: mint, symbol: "TKN", name: "Token" }, quoteToken: { address: "Q" },
    priceUsd: "1", priceNative: "1", liquidity: { usd: 500000 }, volume: { h24: 100000 },
    pairCreatedAt: Date.now() - 400 * 86400000, pairAddress: "pair-" + mint.slice(0, 6)
  }, o);
}

// n signatures for an address, spread `spanSec` seconds apart in total, newest first
export function sigsOver(prefix, n, spanSec, endSec) {
  const end = endSec || 1_800_000_000;
  return Array.from({ length: n }, (_, i) => ({ signature: prefix + "-" + i, blockTime: Math.round(end - (spanSec * i) / Math.max(1, n - 1)) }));
}

export { TOKEN_PROGRAM, TOKEN_2022, SYSTEM_PROGRAM };
