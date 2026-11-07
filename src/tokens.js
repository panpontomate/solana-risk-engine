import { TOKEN_PROGRAM, TOKEN_2022, SYSTEM_PROGRAM } from "./constants.js";
import { isCancel } from "./errors.js";
import { onCurve, b58bytes } from "./curve.js";
import { uniq } from "./util.js";
import { knownWallet } from "./known.js";

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
  const exts = p.extensions || [];
  const state = function (name) { const e = exts.find(function (x) { return x.extension === name; }); return (e && e.state) || {}; };
  const hook = state("transferHook");
  return {
    mintAuth: p.mintAuthority || null, freezeAuth: p.freezeAuthority || null,
    supply: Number(p.supply || 0), decimals: Number(p.decimals || 0),
    ext: exts.map(function (e) { return e.extension; }),
    // what the extensions are set to: a transfer hook with no program and no authority does nothing, and
    // "default account state" only matters when new accounts are born frozen
    hook: { program: hook.programId || null, auth: hook.authority || null },
    defaultState: state("defaultAccountState").accountState || null,
    // transfer fee in basis points (the higher of the current and the scheduled one); null when not set
    feeBps: feeBps(state("transferFeeConfig")),
    // every key that controls something in the extensions (delegate, hook, pause, metadata...)
    extKeys: extKeys(exts),
    program: r.value.owner || null
  };
}

function feeBps(s) {
  const a = s.newerTransferFee && s.newerTransferFee.transferFeeBasisPoints, b = s.olderTransferFee && s.olderTransferFee.transferFeeBasisPoints;
  return (typeof a === "number" || typeof b === "number") ? Math.max(Number(a) || 0, Number(b) || 0) : null;
}

function extKeys(exts) {
  const out = [];
  exts.forEach(function (e) {
    Object.keys(e.state || {}).forEach(function (k) {
      const v = e.state[k];
      if (typeof v === "string" && /authority$|^delegate$|^programId$/i.test(k) && out.indexOf(v) < 0) out.push(v);
    });
  });
  return out;
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
    const kind = await accountKinds(client, uniq(owners), true);   // emptied wallets (0 SOL) still count
    const agg = {};
    owners.forEach(function (o, i) { agg[o] = (agg[o] || 0) + amts[i]; });
    const ws = [], exs = {}, mms = {};
    let prog = 0, ex = 0, mm = 0;
    Object.keys(agg).forEach(function (o) {
      const k = knownWallet(o);
      if (kind[o] === "wallet" && k && k.t === "exchange") { ex += agg[o]; exs[k.n] = (exs[k.n] || 0) + agg[o]; }   // users' funds, not one person
      else if (kind[o] === "wallet") {
        ws.push(agg[o]);
        if (k && k.t === "market_maker") { mm += agg[o]; mms[k.n] = (mms[k.n] || 0) + agg[o]; }   // named, still counted
      }
      else prog += agg[o];
    });
    ws.sort(function (x, y) { return y - x; });
    out.ok = true; out.nW = ws.length;
    out.w1 = ws.length ? ws[0] / supply * 100 : 0;
    out.w10 = ws.slice(0, 10).reduce(function (s, x) { return s + x; }, 0) / supply * 100;
    out.prog = prog / supply * 100;
    if (ex) {
      out.ex = ex / supply * 100;
      out.exn = Object.keys(exs).sort(function (x, y) { return exs[y] - exs[x]; });
    }
    if (mm) {
      out.mm = mm / supply * 100;
      out.mmn = Object.keys(mms).sort(function (x, y) { return mms[y] - mms[x]; });
    }
  } catch (e) { if (isCancel(e)) throw e; }
  return out;
}
