#!/usr/bin/env node
// Minimal command line scanner:
//   node examples/cli.js <token-or-wallet> [--lang en] [--rpc https://...] [--json]
//   node examples/cli.js holders <mint> --rpc https://mainnet.helius-rpc.com/?api-key=...
import {
  createScanner, describe, explainLight, lightLabel, levelLabel, typeInfo, describeStep, describeError, format
} from "../src/index.js";

const args = process.argv.slice(2);
function opt(name) { const i = args.indexOf("--" + name); return i >= 0 ? args.splice(i, 2)[1] : undefined; }
function flag(name) { const i = args.indexOf("--" + name); if (i >= 0) { args.splice(i, 1); return true; } return false; }

const lang = opt("lang") || "es";
const rpcUrl = opt("rpc") || process.env.SOLANA_RPC_URL;
const asJson = flag("json");
const mode = args[0] === "holders" ? args.shift() : "address";
const addr = args[0];

if (!addr) {
  console.error("usage: solana-risk <token-or-wallet> [--lang es|en] [--rpc URL] [--json]\n       solana-risk holders <mint> [--rpc URL]");
  process.exit(1);
}

const ctrl = new AbortController();
process.on("SIGINT", () => ctrl.abort());
const scanner = createScanner({ rpcUrl: rpcUrl, signal: ctrl.signal });
const f = format(lang);
const onProgress = asJson ? undefined : (p, frac) => process.stderr.write("\r" + Math.round(frac * 100) + "% " + describeStep(p, lang) + "\x1b[K");
const ICON = { ok: "🟢", na: "⚪", warn: "🟡", bad: "🔴" };

function printToken(r) {
  console.log(`\n${r.sym}${r.name ? " · " + r.name : ""}  —  ${levelLabel(r, lang)}`);
  const t = typeInfo(r.type, lang);
  if (t) console.log(`${t.label}: ${t.note}`);
  if (r.lights) r.lights.forEach((l) => console.log(`  ${ICON[l.s]} ${lightLabel(l.k, lang)}: ${explainLight(l, lang)}`));
  else r.reasons.forEach((x) => console.log(`  • ${describe(x, lang)}`));
}

try {
  if (mode === "holders") {
    const h = await scanner.analyzeHolders(addr, { onProgress });
    if (onProgress) process.stderr.write("\r\x1b[K");
    if (asJson) { console.log(JSON.stringify(h, null, 2)); process.exit(0); }
    console.log(`\n${h.sym} · top holders`);
    h.rows.slice(0, 20).forEach((r) => {
      const c = h.clusters[r.owner];
      console.log(`  #${r.rank} ${f.short(r.owner)}  ${r.pct.toFixed(2)}%  ${f.usd(r.value)}  ${r.kind}${c ? "  group " + c.id + " (" + c.n + ")" : ""}`);
    });
    if (h.creator) console.log(`\ncreator ${f.short(h.creator.addr)} · other tokens: ${h.creator.others.length}${h.creator.rugged ? " · RUGGED" : ""}`);
  } else {
    const r = await scanner.analyzeAddress(addr, { onProgress });
    if (onProgress) process.stderr.write("\r\x1b[K");
    if (asJson) { console.log(JSON.stringify(r, null, 2)); process.exit(0); }
    if (r.kind === "token") printToken(r.token);
    else {
      const w = r.wallet;
      console.log(`\nwallet ${f.short(w.wallet)} · ${w.sol.toFixed(3)} SOL · ${w.total} tokens (${w.hidden} dust hidden)`);
      w.results.forEach(printToken);
    }
  }
} catch (e) {
  if (onProgress) process.stderr.write("\r\x1b[K");
  console.error(describeError(e, lang, { ownRpc: !!rpcUrl }));
  process.exit(1);
}
