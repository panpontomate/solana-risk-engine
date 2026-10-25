import { TOKEN_PROGRAM, TOKEN_2022, SYSTEM_PROGRAM } from "./constants.js";
import { isCancel } from "./errors.js";
import { onCurve, b58bytes } from "./curve.js";
import { uniq } from "./util.js";

// SOL balance and every token the wallet holds (classic SPL + Token-2022), summed by mint
export async function getTokens(client, wallet) {
  const res = await Promise.all([
    client.rpc("getBalance", [wallet]),
    client.rpc("getTokenAccountsByOwner", [wallet, { programId: TOKEN_PROGRAM }, { encoding: "jsonParsed" }]),
    client.rpc("getTokenAccountsByOwner", [wallet, { programId: TOKEN_2022 }, { encoding: "jsonParsed" }])
  ]);
  const tokens = {};
  [res[1], res[2]].forEach(function (r) {
    r.value.forEach(function (c) {
      const info = c.account.data.parsed.info;
      const q = Number(info.tokenAmount.uiAmount || 0);
      if (q > 0) tokens[info.mint] = (tokens[info.mint] || 0) + q;
    });
  });
  return { sol: res[0].value / 1e9, tokens: tokens };
}

// A mint account belongs to a token program; a wallet belongs to the System Program
export async function isMint(client, addr) {
  try {
    const r = await client.rpc("getAccountInfo", [addr, { encoding: "jsonParsed" }]);
    const v = r && r.value;
    return !!(v && (v.owner === TOKEN_PROGRAM || v.owner === TOKEN_2022) && v.data && v.data.parsed && v.data.parsed.type === "mint");
  } catch (e) { if (isCancel(e)) throw e; return false; }   // if it cannot be known, treat it as a wallet
}

export async function getMint(client, mint) {
  const r = await client.rpc("getAccountInfo", [mint, { encoding: "jsonParsed" }]);
  const p = r && r.value && r.value.data && r.value.data.parsed && r.value.data.parsed.info;
  if (!p) return null;
  return {
    mintAuth: p.mintAuthority || null, freezeAuth: p.freezeAuthority || null,
    supply: Number(p.supply || 0), decimals: Number(p.decimals || 0),
    ext: (p.extensions || []).map(function (e) { return e.extension; })
  };
}

// A key off the ed25519 curve has no private key: only a program can sign for it (a PDA), whoever
// owns its account. PDAs that hold SOL (stake pool and AMM authorities) are owned by the System
// Program like any wallet, so the owner alone would count them as people.
export function kindOf(key, account, missingIsWallet) {
  if (!onCurve(b58bytes(key))) return "program";
  if (account) return account.owner === SYSTEM_PROGRAM ? "wallet" : "program";
  return missingIsWallet ? "wallet" : "program";
}

// "wallet" or "program" for each address
export async function accountKinds(client, addrs, missingIsWallet) {
  if (!addrs.length) return {};
  const r = await client.rpc("getMultipleAccounts", [addrs, { encoding: "base64", dataSlice: { offset: 0, length: 0 } }]);
  const out = {};
  addrs.forEach(function (k, i) { out[k] = kindOf(k, r.value[i], missingIsWallet); });
  return out;
}

// Who controls the mint and freeze authorities: a person's wallet or a program (bridge, protocol)
export async function getAuthKinds(client, info) {
  const keys = [];
  [info.mintAuth, info.freezeAuth].forEach(function (a) { if (a && keys.indexOf(a) < 0) keys.push(a); });
  if (!keys.length) return {};
  return accountKinds(client, keys, true);   // no account but on the curve: an empty wallet
}

// Concentration of the supply. Each large account is traced to its owner: a pool or a program
// holding tokens is not a whale, so w1/w10 count only people's wallets.
export async function getConc(client, mint, supply) {
  const r = await client.rpc("getTokenLargestAccounts", [mint]);
  const v = (r && r.value) || [];
  if (!v.length || supply <= 0) throw new Error("no holder data");
  const amts = v.map(function (x) { return Number(x.amount); });
  const out = {
    ok: false,
    top1: amts[0] / supply * 100,
    top10: amts.slice(0, 10).reduce(function (s, x) { return s + x; }, 0) / supply * 100
  };
  const addrs = v.map(function (x) { return x.address; });
  if (addrs.some(function (x) { return !x; })) return out;
  try {
    const ta = await client.rpc("getMultipleAccounts", [addrs, { encoding: "jsonParsed" }]);
    const owners = ta.value.map(function (x) {
      return x && x.data && x.data.parsed && x.data.parsed.info && x.data.parsed.info.owner || null;
    });
    if (owners.some(function (o) { return !o; })) return out;
    const kind = await accountKinds(client, uniq(owners), false);
    const agg = {};
    owners.forEach(function (o, i) { agg[o] = (agg[o] || 0) + amts[i]; });
    const ws = [];
    let prog = 0;
    Object.keys(agg).forEach(function (o) { if (kind[o] === "wallet") ws.push(agg[o]); else prog += agg[o]; });
    ws.sort(function (x, y) { return y - x; });
    out.ok = true; out.nW = ws.length;
    out.w1 = ws.length ? ws[0] / supply * 100 : 0;
    out.w10 = ws.slice(0, 10).reduce(function (s, x) { return s + x; }, 0) / supply * 100;
    out.prog = prog / supply * 100;
  } catch (e) { if (isCancel(e)) throw e; }
  return out;
}
