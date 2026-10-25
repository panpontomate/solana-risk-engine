import test from "node:test";
import assert from "node:assert/strict";
import { createClient, createScanner, ScanError, TOKEN_PROGRAM, SYSTEM_PROGRAM, PUBLIC_RPC, VIBE_RPC, DEX } from "../src/index.js";
import { mockFetch, A } from "./helpers.js";

const OWN = "https://rpc.example.test/?key=1";
const DAY = 86400000;

// A creator-controlled token: mint authority in a wallet, one person holds 50%, $5k liquidity
function tokenRoutes(over) {
  const routes = {
    rpc: {
      getAccountInfo: () => ({ value: { owner: TOKEN_PROGRAM, data: { parsed: { type: "mint", info: { mintAuthority: A.creator, freezeAuthority: null, supply: "1000000", decimals: 6 } } } } }),
      getTokenLargestAccounts: () => ({ value: [{ address: A.acc1, amount: "500000" }, { address: A.acc2, amount: "100000" }] }),
      getMultipleAccounts: (p) => {
        if (p[1].encoding === "jsonParsed") return { value: p[0].map((a) => ({ data: { parsed: { info: { owner: a === A.acc1 ? A.owner1 : A.owner2 } } } })) };
        return { value: p[0].map((a) => ({ owner: a === A.owner2 ? "SomeAmmProgram1111111111111111111111111111" : SYSTEM_PROGRAM })) };
      }
    },
    http: {
      [DEX]: () => [{ baseToken: { address: A.mint, symbol: "SCAM", name: "Scam" }, quoteToken: { address: "Other" }, priceUsd: "0.01", liquidity: { usd: 5000 }, volume: { h24: 20000 }, pairCreatedAt: Date.now() - 3 * DAY }],
      "https://api.rugcheck.xyz/": () => ({ __status: 404 })
    }
  };
  if (over) Object.assign(routes.rpc, over);
  return routes;
}

test("analyzeToken end to end with a mocked network", async () => {
  const f = mockFetch(tokenRoutes());
  const scanner = createScanner({ rpcUrl: OWN, fetch: f, retryDelayMs: 0 });
  const steps = [];
  const r = await scanner.analyzeToken(A.mint, { onProgress: (p) => steps.push(p.step) });
  assert.equal(r.lvl, "HIGH");
  assert.equal(r.type, "CREATOR");
  assert.equal(r.sym, "SCAM");
  assert.deepEqual(r.lights.map((l) => l.s), ["bad", "bad", "bad", "ok"]);
  assert.equal(r.lights[1].items[0].data.w1, 50);
  assert.ok(r.reasons.some((x) => x.code === "MKT_LIQ_VERY_LOW"));
  assert.ok(steps.includes("done"));
  // everything went to the user's own RPC
  assert.ok(f.calls.filter((c) => c.method).every((c) => c.url === OWN));
});

test("analyzeToken flags NFTs and bad addresses", async () => {
  const f = mockFetch(tokenRoutes({
    getAccountInfo: () => ({ value: { owner: TOKEN_PROGRAM, data: { parsed: { type: "mint", info: { supply: "1", decimals: 0 } } } } })
  }));
  const scanner = createScanner({ rpcUrl: OWN, fetch: f, retryDelayMs: 0 });
  await assert.rejects(scanner.analyzeToken(A.mint), (e) => e instanceof ScanError && e.code === "IS_NFT");
  await assert.rejects(scanner.analyzeToken("0xabc"), (e) => e.code === "INVALID_ADDRESS");
});

test("analyzeAddress tells wallets from mints and analyzeWallet hides dust", async () => {
  const routes = tokenRoutes({
    getAccountInfo: (p) => p[0] === A.wallet ? { value: { owner: SYSTEM_PROGRAM, data: ["", "base64"] } } : tokenRoutes().rpc.getAccountInfo(p),
    getBalance: () => ({ value: 2e9 }),
    getTokenAccountsByOwner: (p) => p[1].programId === TOKEN_PROGRAM
      ? { value: [
        { account: { data: { parsed: { info: { mint: A.mint, tokenAmount: { uiAmount: 1000 } } } } } },
        { account: { data: { parsed: { info: { mint: A.acc2, tokenAmount: { uiAmount: 1 } } } } } }] }
      : { value: [] }
  });
  routes.http[DEX] = () => [
    { baseToken: { address: A.mint, symbol: "SCAM" }, priceUsd: "0.01", liquidity: { usd: 5000 }, volume: { h24: 20000 } },
    { baseToken: { address: A.acc2, symbol: "DUST" }, priceUsd: "0.5", liquidity: { usd: 99999 }, volume: { h24: 9999 } }
  ];
  const scanner = createScanner({ rpcUrl: OWN, fetch: mockFetch(routes), retryDelayMs: 0 });
  const r = await scanner.analyzeAddress(A.wallet);
  assert.equal(r.kind, "wallet");
  assert.equal(r.wallet.sol, 2);
  assert.equal(r.wallet.total, 2);
  assert.equal(r.wallet.hidden, 1);                // $0.50 of DUST is under the $1 default
  assert.equal(r.wallet.results.length, 1);
  assert.equal(r.wallet.results[0].value, 10);
});

test("free mode: blocked methods go to Vibe Station, big getMultipleAccounts is split", async () => {
  const f = mockFetch({
    rpc: {
      getTokenLargestAccounts: () => ({ value: [] }),
      getMultipleAccounts: (p) => ({ context: {}, value: p[0].map(() => null) })
    }
  });
  const c = createClient({ fetch: f, vibeIntervalMs: 0, retryDelayMs: 0 });
  assert.equal(c.ownRpc(), false);
  await c.rpc("getTokenLargestAccounts", ["x"]);
  assert.equal(f.calls[0].url, VIBE_RPC);
  const keys = Array.from({ length: 25 }, (_, i) => "k" + i);
  const r = await c.rpc("getMultipleAccounts", [keys, {}]);
  assert.equal(r.value.length, 25);
  const pn = f.calls.filter((x) => x.url === PUBLIC_RPC);
  assert.equal(pn.length, 3);
  assert.deepEqual(pn.map((x) => x.params[0].length), [10, 10, 5]);
});

test("free mode: a method PublicNode rejects with 403 is retried on Vibe and remembered", async () => {
  const f = mockFetch({ rpc: { getSignaturesForAddress: (p, url) => url === PUBLIC_RPC ? { __status: 403 } : [] } });
  const c = createClient({ fetch: f, vibeIntervalMs: 0, retryDelayMs: 0 });
  await c.rpc("getSignaturesForAddress", ["a"]);
  await c.rpc("getSignaturesForAddress", ["b"]);
  assert.deepEqual(f.calls.map((x) => x.url), [PUBLIC_RPC, VIBE_RPC, VIBE_RPC]);
});

test("retries on 429 then fails with a coded error", async () => {
  let n = 0;
  const f = async () => { n++; return { status: 429, ok: false, json: async () => ({}) }; };
  const c = createClient({ rpcUrl: OWN, fetch: f, retryDelayMs: 0 });
  await assert.rejects(c.rpc("getBalance", ["x"]), (e) => e.code === "HTTP" && e.data.status === 429);
  assert.equal(n, 4);
});

test("an aborted signal cancels with CANCELLED", async () => {
  const ctrl = new AbortController();
  ctrl.abort();
  const c = createClient({ rpcUrl: OWN, fetch: mockFetch({ rpc: {} }), signal: ctrl.signal });
  await assert.rejects(c.rpc("getBalance", ["x"]), (e) => e.code === "CANCELLED");
});

test("heliusKey is only taken from a Helius URL", () => {
  assert.equal(createClient({ rpcUrl: "https://mainnet.helius-rpc.com/?api-key=abc", fetch: () => {} }).heliusKey(), "abc");
  assert.equal(createClient({ rpcUrl: "https://evil.example/?api-key=abc", fetch: () => {} }).heliusKey(), null);
  assert.equal(createClient({ heliusApiKey: "k", fetch: () => {} }).heliusKey(), "k");
});

test("estimatePnl without Helius fails with HELIUS_REQUIRED", async () => {
  const scanner = createScanner({ rpcUrl: OWN, fetch: mockFetch({ rpc: {} }) });
  await assert.rejects(scanner.estimatePnl([A.wallet], { balances: {} }), (e) => e.code === "HELIUS_REQUIRED");
});
