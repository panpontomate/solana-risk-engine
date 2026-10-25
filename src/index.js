import { createClient } from "./client.js";
import { analyzeToken, analyzeWallet, analyzeAddress } from "./wallet.js";
import { analyzeHolders } from "./holders.js";
import { estimatePnl } from "./pnl.js";
import { takeSnapshots } from "./changes.js";
import { confluence, commonHolders } from "./confluence.js";
import { getTokens } from "./tokens.js";

/**
 * The easy entry point: one object with every high-level analysis bound to one network client.
 *
 *   const scanner = createScanner({ rpcUrl: "https://mainnet.helius-rpc.com/?api-key=..." });
 *   const r = await scanner.analyzeToken(mint);
 *
 * Options are those of createClient (rpcUrl, heliusApiKey, signal, fetch...). Each method also
 * accepts its own opts (onProgress, ...), see the module docs.
 */
export function createScanner(opts) {
  const client = createClient(opts);
  return {
    client: client,
    analyzeToken: (mint, o) => analyzeToken(client, mint, o),
    analyzeWallet: (wallet, o) => analyzeWallet(client, wallet, o),
    analyzeAddress: (addr, o) => analyzeAddress(client, addr, o),
    analyzeHolders: (mint, o) => analyzeHolders(client, mint, o),
    estimatePnl: async (wallets, o) => {
      // Current balances trim tokens the wallet moved away; read them if the caller did not pass them
      o = o || {};
      let bal = o.balances;
      if (!bal) {
        bal = {};
        for (const w of wallets) bal[w] = (await getTokens(client, w)).tokens;
      }
      return estimatePnl(client, wallets, bal, o);
    },
    takeSnapshots: (wallets, o) => takeSnapshots(client, wallets, o),
    confluence: (wallets, o) => confluence(client, wallets, o),
    commonHolders: (mints, o) => commonHolders(client, mints, o)
  };
}

export { createClient };
export { ScanError, isCancel } from "./errors.js";
export * from "./constants.js";
export { isOnCurve, onCurve, b58bytes } from "./curve.js";
export { getTokens, getMint, getConc, getAuthKinds, isMint, accountKinds, kindOf } from "./tokens.js";
export { getMarkets, realLiq, impostorOf, INFLATED_RATIO, geckoLiquidity, geckoPair } from "./markets.js";
export { rugcheckSummary, rugcheckReport, rugcheckGraph, netBalances, creatorLaunches } from "./rugcheck.js";
export { score, tokenType, buildLights, levelFrom, dataOnly, reasonsFrom, assess, SERIAL_WARN, SERIAL_BAD } from "./risk.js";
export { recentLaunches } from "./launch.js";
export { analyzeToken, analyzeWallet, analyzeAddress, sortResults } from "./wallet.js";
export { holderBase, markBusy, findFunder, findFunders, clusterByFunder, holderRows, creatorInfo, analyzeHolders } from "./holders.js";
export { fetchSwaps, solHistory, priceSeries, parseTrades, pnlFromTrades, pnlStatus, estimatePnl } from "./pnl.js";
export { capSnap, chgDiff, chgAgg, takeSnapshots, diffSnapshots } from "./changes.js";
export { confluence, commonHolders } from "./confluence.js";
export { describe, explainLight, lightLabel, levelLabel, missingText, typeInfo, describeStep, describeNote, describeError, format, addLanguage } from "./i18n/index.js";
