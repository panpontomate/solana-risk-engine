# solana-risk-engine

Explainable risk analysis for Solana tokens and wallets. **Zero dependencies**, runs in **Node 18+ and the browser**, works with free public RPCs out of the box.

It doesn't stop at a single score. Every verdict comes with the **signals** behind it, as stable codes plus the numbers involved. Apps can show them in any language (Spanish and English are included).

```js
import { createScanner, explainLight, lightLabel, levelLabel } from "solana-risk-engine";

const scanner = createScanner();                      // free PublicNode + Vibe Station, or { rpcUrl }
const r = await scanner.analyzeToken("7xKX...gAsU");

console.log(r.lvl);        // "HIGH"
console.log(r.type);       // "CREATOR"
for (const l of r.lights)  // the four traffic lights
  console.log(l.s, lightLabel(l.k, "en"), "-", explainLight(l, "en"));
// bad  Creator control - The creator can mint more tokens (mint authority active)
// bad  Concentration   - The largest individual wallet holds 50% and the top 10 hold 60% of the supply
// bad  Market and exit - Very low liquidity ($5,000). Very new market (3 days)
// ok   Dependency      - Does not depend on an issuer or a bridge
```

## What it detects

| Check | How |
|---|---|
| **Creator control** | Mint/freeze authority still active, and whether it sits in a person's wallet or a program (bridge, protocol, staking pool). A key off the ed25519 curve is always a program (PDA), even when the System Program owns its account. Risky Token-2022 extensions: permanent delegate, transfer hook, transfer fee, non-transferable, default-frozen accounts. |
| **Real concentration** | Largest accounts are traced to their owners. Pools and programs are separated from people, so `w1`/`w10` measure *people*, not AMM vaults. |
| **Inflated liquidity** | DexScreener values both sides of a pool at the pool's price. A pool with 4B of a token against 2 USDC shows "$4,000M liquidity". The engine recomputes it from the real side (USDC/USDT/SOL). It only flags extreme gaps (real side under 5%), because concentrated-liquidity pools are lopsided by nature. |
| **Unlocked LP** | % of LP locked/burned via RugCheck. It only counts for markets under 90 days old, so veteran tokens don't get false positives, and never while a token is on Pump.fun's bonding curve, where there is no LP to pull. |
| **Serial creators** | For markets under 7 days: how many other tokens the creator launched in the last 24 h (RugCheck). 2 or more is a warning, 5 or more a red flag. `recentLaunches(client, wallet)` counts the same on chain for the wallet that *paid* a launch, which catches farms that name a fresh creator each time. |
| **Impostors** | Tokens using the symbol or name of a famous token (USDC, JUP, BONK, WIF, BTC, ETH...) with a different address. |
| **Token type** | `STABLE`, `TOKENIZED`, `BRIDGED`, `CREATOR`, `OPEN`. Each type is judged by the rules that fit it: a bridged token normally has a program as mint authority, a memecoin does not. |
| **Bots and exchanges** | Wallets that made 200 transactions in under 2 days are marked `active` and are not counted as whales. |
| **Funder clusters** | The fee payer of each holder's *first* transaction reveals who created it. Holders sharing a funder are grouped, since that is often one team splitting the supply. Exchange hot wallets are excluded as sources. |
| **Creator history** | Other tokens by the same creator and their risk, rugged flag, and insider networks with today's on-chain balances (RugCheck). |
| **Wallet PnL** | FIFO realized and unrealized PnL from the last ~300 swaps, valued with historical SOL prices (Helius + CoinGecko). |
| **Confluence** | Tokens held in common by a group of wallets, each one risk-assessed. Also the reverse: people who are top holders of several tokens. |
| **Change tracking** | Snapshots and diffs (new / bought more / sold part / sold all) per wallet and aggregated across many wallets. |

### How the level is decided

- Two red lights, or one red and one yellow, give **HIGH**.
- One red, or two yellows, give **MEDIUM**.
- Otherwise the level is **LOW**, with two exceptions that raise it to **MEDIUM**:
  - **A check could not run.** Lights that could not be checked are marked `na`, and they never count as "fine". `dataOnly(r)` tells you when this is the only reason.
  - **The market is under 7 days old.** It has no track record yet.
- An impostor of a famous token is always **HIGH**.

A single yellow on an established token stays LOW, because those warnings are normal for its type (a staking pool's program-controlled mint, for example). This was measured on 62 real tokens: the 7-day rule moved 9 brand-new tokens from low to medium and no established one.

## Install

```sh
npm install solana-risk-engine
```

## API

### `createScanner(options)`

| Option | |
|---|---|
| `rpcUrl` | Your own RPC (Helius, Triton, QuickNode...). Without it, PublicNode is used, with Solana Vibe Station (rate-limited queue) for the methods PublicNode blocks. |
| `heliusApiKey` | For PnL. Taken from `rpcUrl` automatically when that is a Helius URL. It is never sent anywhere else. |
| `signal` | An `AbortSignal`. Aborting rejects pending work with `ScanError` code `CANCELLED`. |
| `fetch` | Custom fetch (tests, proxies). |

Methods (all accept `{ onProgress(step, fraction) }`):

| Method | Returns |
|---|---|
| `analyzeToken(mint, { skipCreator })` | `{ lvl, sev, type, lights, reasons, impostor, pair, creator, ... }` |
| `analyzeWallet(wallet, { minUsd })` | `{ sol, balances, total, hidden, results: [token results] }` |
| `analyzeAddress(addr)` | `{ kind: "token" \| "wallet", ... }`, detected automatically |
| `analyzeHolders(mint)` | `{ rows, clusters, hotGroups, creator, ... }`. Best with your own RPC. |
| `estimatePnl(wallets)` | `{ pnl: { [wallet]: { realized, unreal, total, ret, st, open } } }`. Needs Helius. |
| `takeSnapshots(wallets)` | Today's holdings. Store them yourself and pass them to `diffSnapshots(prev, next)`. |
| `confluence(wallets, { pct, withPnl, pnlFilter })` | Tokens held in common, with risk. |
| `commonHolders(mints, { min })` | Wallets that are top holders of several tokens. |

Every lower-level function is exported too (`buildLights`, `levelFrom`, `realLiq`, `clusterByFunder`, `chgDiff`, `pnlFromTrades`...). Most are pure functions that are easy to reuse and test.

### Results

```js
{
  lvl: "HIGH" | "MEDIUM" | "LOW" | "SPAM" | "NO_DATA" | "NO_MARKET",
  type: "STABLE" | "TOKENIZED" | "BRIDGED" | "CREATOR" | "OPEN" | null,
  lights: [                       // null for tokens without a market
    { k: "control" | "concentration" | "market" | "dependency",
      s: "ok" | "na" | "warn" | "bad",
      items: [{ code: "MKT_LIQ_INFLATED", s: "bad", data: { reported: 4e9, real: 2 } }] }
  ],
  reasons: [ ...every non-ok signal ],
  sev: 6                          // for sorting within a level
}
```

### Texts and languages

```js
import { describe, explainLight, levelLabel, typeInfo, describeStep, describeError, addLanguage } from "solana-risk-engine";

describe({ code: "MKT_LIQ_VERY_LOW", data: { liq: 3000 } }, "es");   // "Liquidez muy baja (3.000 $)"
describeError(err, "en", { ownRpc: true });                          // friendly message for any ScanError
addLanguage("pt", { signals: { ... }, levels: { ... } });            // same shape as src/i18n/en.js
```

### Errors

The engine throws `ScanError` with a stable `code`: `CANCELLED`, `HTTP`, `NETWORK`, `RPC`, `DEX_UNREACHABLE`, `HELIUS_REQUIRED`, `SOL_PRICE`, `INVALID_ADDRESS`, `NOT_A_TOKEN`, `IS_NFT`, `NO_HOLDERS`, `TOO_FEW_WALLETS`, `TOO_FEW_TOKENS`.

Optional extras (RugCheck) never throw. If they fail, the analysis goes on without them.

## CLI

```sh
npx solana-risk <token-or-wallet> --lang en
npx solana-risk holders <mint> --rpc "https://mainnet.helius-rpc.com/?api-key=..."
npx solana-risk <mint> --json
```

## Data sources

- Solana RPC: [PublicNode](https://solana-rpc.publicnode.com), [Solana Vibe Station](https://solanavibestation.com), or yours
- [DexScreener](https://dexscreener.com): pairs, price, liquidity, volume
- [RugCheck](https://rugcheck.xyz): LP lock, creator, insider networks (optional)
- [Helius](https://helius.dev): parsed swap history for PnL (optional, your key)
- [CoinGecko](https://coingecko.com): SOL price history for PnL

## Development

```sh
npm test      # node --test, no network needed: the network is mocked
```

## Disclaimer

This is a heuristic tool, not financial advice. A "low risk" result means the engine found none of the signals it looks for. It does not mean the token is safe.

## License

MIT
