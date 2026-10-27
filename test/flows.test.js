import test from "node:test";
import assert from "node:assert/strict";
import {
  createScanner, createClient, assess, getTokens, getConc, getAuthKinds, isMint, getMarkets, takeSnapshots, diffSnapshots,
  fetchSwaps, isOnCurve, recentLaunches, USDC, WSOL, TOKEN_2022, SYSTEM_PROGRAM, PUMP_PROGRAM, FAMOUS
} from "../src/index.js";
import { fakeChain, addr, pda, pairOf, sigsOver, b58encode } from "./fakechain.js";
import { generateKeyPairSync } from "node:crypto";

const OWN = "https://rpc.example.test/";
const DAY = 86400000;
const client = (world, o) => createClient(Object.assign({ rpcUrl: OWN, fetch: fakeChain(world), retryDelayMs: 0 }, o));
const scanner = (world, o) => createScanner(Object.assign({ rpcUrl: OWN, fetch: fakeChain(world), retryDelayMs: 0 }, o));
const AMM = "AmmProgram11111111111111111111111111111111";

/* ---------- tokens.js ---------- */

test("getTokens sums classic and Token-2022 accounts and skips empty ones", async () => {
  const W = addr("w"), T = addr("t"), T22 = addr("t22"), Z = addr("z");
  const c = client({ mints: { [T22]: { supply: 1, decimals: 0, program: TOKEN_2022 } }, wallets: { [W]: { sol: 1.5, tokens: { [T]: 3, [T22]: 7, [Z]: 0 } } } });
  assert.deepEqual(await getTokens(c, W), { sol: 1.5, tokens: { [T]: 3, [T22]: 7 } });
});

test("isMint: mints yes, wallets no, RPC failure counts as wallet", async () => {
  const M = addr("m"), W = addr("w");
  assert.equal(await isMint(client({ mints: { [M]: { supply: 5, decimals: 0 } } }), M), true);
  assert.equal(await isMint(client({ wallets: { [W]: {} } }), W), false);
  assert.equal(await isMint(client({ fail: { rpc: { getAccountInfo: 400 } } }), M), false);
});

test("getAuthKinds: account owner decides, and the curve decides for keys with no account", async () => {
  const real = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).subarray(-32);
  const walletKey = b58encode([...real]);
  const noAccountPda = pda("authority");
  assert.equal(isOnCurve(walletKey), true);
  const PROG = addr("prog"), PERSON = addr("person");
  const c = client({ owners: { [PROG]: AMM, [PERSON]: SYSTEM_PROGRAM } });
  assert.deepEqual(await getAuthKinds(c, { mintAuth: PROG, freezeAuth: PERSON }), { [PROG]: "program", [PERSON]: "wallet" });
  assert.deepEqual(await getAuthKinds(c, { mintAuth: walletKey, freezeAuth: noAccountPda }), { [walletKey]: "wallet", [noAccountPda]: "program" });
  assert.deepEqual(await getAuthKinds(c, { mintAuth: null, freezeAuth: null }), {});
});

// Regression: JitoSOL's mint authority is a stake-pool PDA that holds SOL, so its account is owned
// by the System Program like a wallet. It was reported as "the creator can mint more".
test("a PDA owned by the System Program is still a program, not a person", async () => {
  const STAKE_PDA = pda("stake-pool-withdraw"), M = addr("lst"), POOL_AUTH = pda("amm-authority"), P = addr("person");
  const c = client({
    owners: { [STAKE_PDA]: SYSTEM_PROGRAM, [POOL_AUTH]: SYSTEM_PROGRAM, [P]: SYSTEM_PROGRAM },
    largest: { [M]: [{ address: addr("vault"), amount: 800, owner: POOL_AUTH }, { address: addr("pa"), amount: 100, owner: P }] }
  });
  assert.deepEqual(await getAuthKinds(c, { mintAuth: STAKE_PDA, freezeAuth: null }), { [STAKE_PDA]: "program" });
  const conc = await getConc(c, M, 1000);
  assert.equal(conc.w1, 10);        // the AMM authority's 80% is not a whale
  assert.equal(conc.prog, 80);
  const w = { mints: { [M]: { supply: 1000, decimals: 0, mintAuthority: STAKE_PDA } }, owners: { [STAKE_PDA]: SYSTEM_PROGRAM, [POOL_AUTH]: SYSTEM_PROGRAM, [P]: SYSTEM_PROGRAM },
    largest: { [M]: [{ address: addr("vault"), amount: 800, owner: POOL_AUTH }, { address: addr("pa"), amount: 100, owner: P }] }, pairs: [pairOf(M)] };
  const r = await scanner(w).analyzeToken(M);
  assert.equal(r.type, "BRIDGED");
  assert.equal(r.lights[0].s, "ok");
  assert.equal(r.lvl, "LOW");
});

test("getConc counts people only, and falls back when owners are unknown", async () => {
  const M = addr("m"), P = addr("p"), Q = addr("q"), POOL = addr("pool");
  const world = {
    largest: { [M]: [{ address: addr("a1"), amount: 600, owner: POOL }, { address: addr("a2"), amount: 300, owner: P }, { address: addr("a3"), amount: 100, owner: Q }] },
    owners: { [POOL]: AMM, [P]: SYSTEM_PROGRAM, [Q]: SYSTEM_PROGRAM }
  };
  const r = await getConc(client(world), M, 1000);
  assert.equal(r.ok, true);
  assert.equal(r.top1, 60);
  assert.equal(r.w1, 30);
  assert.equal(r.w10, 40);
  assert.equal(r.prog, 60);
  assert.equal(r.nW, 2);
  // token account owners unreadable: only the raw top1/top10
  const raw = await getConc(client({ largest: { [M]: [{ address: addr("x"), amount: 500 }] } }), M, 1000);
  assert.deepEqual(raw, { ok: false, top1: 50, top10: 50 });
  await assert.rejects(getConc(client({}), M, 1000));
});

/* ---------- markets.js ---------- */

test("getMarkets batches by 30, keeps the most liquid pair and ignores others", async () => {
  const mints = Array.from({ length: 65 }, (_, i) => addr("mk" + i));
  const pairs = [
    pairOf(mints[0], { liquidity: { usd: 100 }, pairAddress: "small" }),
    pairOf(mints[0], { liquidity: { usd: 9000 }, pairAddress: "big" }),
    pairOf(mints[64], { liquidity: { usd: 1 } }),
    pairOf(addr("unasked"), {})
  ];
  const f = fakeChain({ pairs });
  const steps = [];
  const r = await getMarkets(createClient({ fetch: f, retryDelayMs: 0 }), mints, (d, n) => steps.push(d + "/" + n));
  assert.equal(f.calls.length, 3);
  assert.deepEqual(steps, ["30/65", "60/65", "65/65"]);
  assert.equal(r.data[mints[0]].pairAddress, "big");
  assert.ok(r.data[mints[64]]);
  assert.equal(Object.keys(r.data).length, 2);
  assert.deepEqual(r.failed, []);
});

test("getMarkets: a failed batch is 'unknown', an unreachable DexScreener is an error", async () => {
  const mints = Array.from({ length: 40 }, (_, i) => addr("fm" + i));
  let n = 0;
  const f = async (url) => { n++; return n > 1 ?{ status: 500, ok: false, json: async () => ({}) } : { status: 200, ok: true, json: async () => [] }; };
  const r = await getMarkets(createClient({ fetch: f, retryDelayMs: 0 }), mints);
  assert.equal(r.failed.length, 10);       // only the second batch, after its retries
  await assert.rejects(getMarkets(createClient({ fetch: fakeChain({ fail: { dex: "network" } }), retryDelayMs: 0 }), mints), (e) => e.code === "DEX_UNREACHABLE");
});

/* ---------- risk.js assess ---------- */

function riskWorld(mintInfo, pair, extra) {
  const M = addr("riskmint"), P = addr("holder"), POOL = addr("pool");
  return Object.assign({
    M: M,
    mints: { [M]: Object.assign({ supply: 1000, decimals: 0 }, mintInfo) },
    largest: { [M]: [{ address: addr("ra1"), amount: 500, owner: POOL }, { address: addr("ra2"), amount: 50, owner: P }] },
    owners: { [POOL]: AMM, [P]: SYSTEM_PROGRAM },
    pairs: pair ? [pairOf(M, pair)] : []
  }, extra);
}

test("assess: an impostor of a famous token is always high risk", async () => {
  const w = riskWorld({}, { baseToken: { symbol: "JUP", name: "Jupiter" } });
  w.pairs[0].baseToken.address = w.M;
  const r = await scanner(w).analyzeToken(w.M);
  assert.equal(r.lvl, "HIGH");
  assert.equal(r.impostor.real, FAMOUS.JUP);
  assert.equal(r.lights[0].items[0].code, "IMPOSTOR");
  assert.equal(r.lights[0].items.length, 1);   // the "ok" text of a clean control light is dropped
  assert.ok(r.sev >= 5);
});

test("assess: tokens without a market are spam or just 'no market'", async () => {
  const W = addr("auth");
  const spam = riskWorld({ mintAuthority: W }, null, { owners: { [W]: SYSTEM_PROGRAM } });
  const r1 = await scanner(spam).analyzeToken(spam.M);
  assert.equal(r1.lvl, "SPAM");
  assert.equal(r1.pts, 25);
  assert.equal(r1.lights, null);
  const clean = riskWorld({}, null);
  const f = fakeChain(clean);
  const r2 = await createScanner({ rpcUrl: OWN, fetch: f, retryDelayMs: 0 }).analyzeToken(clean.M);
  assert.equal(r2.lvl, "NO_MARKET");
  assert.ok(!f.calls.some((c) => c.method === "getTokenLargestAccounts"));   // no market: concentration skipped
});

test("assess: serial creator from RugCheck, only on markets under 7 days", async () => {
  const w = riskWorld({}, { pairCreatedAt: Date.now() - 2 * DAY });
  const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
  w.rugcheck = { [w.M]: { report: { creator: "Creator1", creatorTokens: [
    { mint: w.M, createdAt: ago(1) }, { mint: "A", createdAt: ago(1) }, { mint: "B", createdAt: ago(2) },
    { mint: "C", createdAt: ago(3) }, { mint: "D", createdAt: ago(5) }, { mint: "E", createdAt: ago(9) }, { mint: "F", createdAt: ago(30) }] } } };
  const r = await scanner(w).analyzeToken(w.M);
  const s = r.lights[0].items.find((x) => x.code === "CTL_SERIAL_CREATOR");
  assert.deepEqual(s, { code: "CTL_SERIAL_CREATOR", s: "bad", data: { n: 5, creator: "Creator1" } });
  assert.deepEqual(r.creator, { creator: "Creator1", day: 5, total: 6, old: 0, dead: 0, best: null });
  // skipCreator, or an old market: RugCheck's full report is not even asked for
  const f = fakeChain(w);
  await createScanner({ rpcUrl: OWN, fetch: f, retryDelayMs: 0 }).analyzeToken(w.M, { skipCreator: true });
  const old = riskWorld({}, { pairCreatedAt: Date.now() - 30 * DAY }), f2 = fakeChain(Object.assign(old, { rugcheck: w.rugcheck }));
  await createScanner({ rpcUrl: OWN, fetch: f2, retryDelayMs: 0 }).analyzeToken(old.M);
  for (const x of [f, f2]) assert.ok(!x.calls.some((c) => /\/report$/.test(c.url)));
});

test("GeckoTerminal fills Pump.fun gaps: curve liquidity and tokens DexScreener does not list yet", async () => {
  const w = riskWorld({}, { dexId: "pumpfun", liquidity: { usd: 0 }, pairCreatedAt: Date.now() - 0.1 * DAY });
  const pa = w.pairs[0].pairAddress;
  w.gecko = { pools: { [pa]: 2429 } };
  const r = await scanner(w).analyzeToken(w.M);
  assert.equal(r.pair.liquidity.usd, 2429);
  assert.equal(r.lights[2].items[0].code, "MKT_LIQ_VERY_LOW");
  assert.equal(r.lights[2].items[0].data.liq, 2429);
  // noGecko keeps DexScreener's figure and asks nothing (a fresh world: the fake returns the same pair object)
  const w2 = riskWorld({}, { dexId: "pumpfun", liquidity: { usd: 0 }, pairCreatedAt: Date.now() - 0.1 * DAY });
  w2.gecko = w.gecko;
  const f = fakeChain(w2);
  const r0 = await createScanner({ rpcUrl: OWN, fetch: f, retryDelayMs: 0 }).analyzeToken(w2.M, { noGecko: true });
  assert.equal(r0.pair.liquidity.usd, 0);
  assert.ok(!f.calls.some((c) => /geckoterminal/.test(c.url)));

  // not on DexScreener at all: the GeckoTerminal pool becomes the market
  const n = riskWorld({}, null);
  n.gecko = { tokens: { [n.M]: { data: [{ attributes: { address: "Pool1", base_token_price_usd: "0.00001", reserve_in_usd: "3100", volume_usd: { h24: "900" }, pool_created_at: new Date(Date.now() - 60000).toISOString() },
    relationships: { dex: { data: { id: "pump-fun" } } } }], included: [{ attributes: { symbol: "NEW", name: "New token", image_url: "missing.png" } }] } } };
  const g = await scanner(n).analyzeToken(n.M);
  assert.equal(g.sym, "NEW");
  assert.equal(g.pair.source, "geckoterminal");
  assert.equal(g.pair.liquidity.usd, 3100);
  assert.ok(g.reasons.some((x) => x.code === "MKT_NEW"));
  assert.ok(!g.reasons.some((x) => x.code === "MKT_LP_UNLOCKED"));
});

test("recentLaunches counts Pump.fun creations paid by a wallet in the last 24 h", async () => {
  const W = addr("farm"), now = 1_800_000_000_000;
  const launch = (m) => ({ transaction: { message: { accountKeys: [{ pubkey: W, signer: true }, { pubkey: m, signer: true }, { pubkey: PUMP_PROGRAM }] } },
    meta: { logMessages: ["Program log: Instruction: CreateV2"], preTokenBalances: [], postTokenBalances: [{ mint: m }] } });
  const buy = { transaction: { message: { accountKeys: [{ pubkey: W }, { pubkey: PUMP_PROGRAM }] } },
    meta: { logMessages: ["Program log: Instruction: Buy"], preTokenBalances: [{ mint: "M1" }], postTokenBalances: [{ mint: "M1" }] } };
  const sigs = [
    { signature: "s1", blockTime: now / 1000 - 60 }, { signature: "s2", blockTime: now / 1000 - 120 },
    { signature: "s3", blockTime: now / 1000 - 3600 }, { signature: "s4", blockTime: now / 1000 - 7200, err: { x: 1 } },
    { signature: "s5", blockTime: now / 1000 - 2 * 86400 }];
  const c = client({ sigs: { [W]: sigs }, txs: { s1: launch("M1"), s2: buy, s3: launch("M2"), s4: launch("M3"), s5: launch("M4") } });
  const r = await recentLaunches(c, W, { now });
  assert.equal(r.n, 2);
  assert.deepEqual(r.mints.sort(), ["M1", "M2"]);
  assert.equal(r.scanned, 3);
  assert.equal(r.more, false);
});

test("assess: skipConcentration, unreadable mint, RugCheck LP signal and unknown market", async () => {
  const w = riskWorld({}, { pairCreatedAt: Date.now() - 10 * DAY });
  w.rugcheck = { [w.M]: { summary: { lpLockedPct: 3, score: 1 } } };
  const s = scanner(w);
  const skipped = await s.analyzeToken(w.M, { skipConcentration: true });
  assert.equal(skipped.lights[1].s, "na");
  assert.equal(skipped.lights[1].items[0].code, "CON_SKIPPED");
  assert.equal(skipped.lights[2].items[0].code, "MKT_LP_UNLOCKED");
  assert.equal(skipped.rugcheck.lpLockedPct, 3);
  assert.equal(skipped.lvl, "MEDIUM");

  const c = createClient({ rpcUrl: OWN, fetch: fakeChain(Object.assign({}, w, { fail: { rpc: { getAccountInfo: 400 } } })), retryDelayMs: 0 });
  const noInfo = await assess(c, w.M, pairOf(w.M));
  assert.equal(noInfo.lights[0].items[0].code, "NO_INFO");
  assert.equal(noInfo.lights[1].items[0].code, "CON_UNAVAILABLE");

  const unknown = await assess(c, w.M, null, { marketUnknown: true, value: 12 });
  assert.equal(unknown.lvl, "NO_DATA");
  assert.equal(unknown.value, 12);
  assert.equal(unknown.reasons[0].code, "MARKET_UNCHECKED");
});

test("assess retries concentration once when getTokenLargestAccounts fails", async () => {
  const w = riskWorld({}, {});
  const base = fakeChain(w);
  let n = 0;
  const f = async (url, init) => {
    if (init && init.body && JSON.parse(init.body).method === "getTokenLargestAccounts" && n++ === 0) return { status: 400, ok: false, json: async () => ({}) };
    return base(url, init);
  };
  const r = await assess(createClient({ rpcUrl: OWN, fetch: f, retryDelayMs: 0 }), w.M, pairOf(w.M));
  assert.equal(n, 2);
  assert.equal(r.lights[1].items[0].code, "CON_OK");
});

/* ---------- wallet.js ---------- */

test("analyzeWallet: sorting, known tokens, inflated-liquidity value cap and progress", async () => {
  const W = addr("wallet"), BAD = addr("bad"), OK = addr("ok"), FAKE = addr("inflated"), NFT = addr("nft"), NOMK = addr("nomk");
  const POOL = addr("pool"), P = addr("p");
  const largest = (m) => [{ address: addr(m + "-a"), amount: 900, owner: POOL }, { address: addr(m + "-b"), amount: 10, owner: P }];
  const w = {
    wallets: { [W]: { sol: 3, tokens: { [USDC]: 50, [BAD]: 1000, [OK]: 10, [FAKE]: 1e9, [NFT]: 1, [NOMK]: 5 } } },
    mints: {
      [BAD]: { supply: 1000, decimals: 0, mintAuthority: P }, [OK]: { supply: 1000, decimals: 0 },
      [FAKE]: { supply: 1e12, decimals: 0 }, [NFT]: { supply: 1, decimals: 0 }, [NOMK]: { supply: 100, decimals: 0 }
    },
    largest: { [BAD]: largest("bad"), [OK]: largest("ok"), [FAKE]: largest("fake") },
    owners: { [POOL]: AMM, [P]: SYSTEM_PROGRAM },
    pairs: [
      pairOf(USDC, { priceUsd: "1" }),
      pairOf(BAD, { priceUsd: "0.01", liquidity: { usd: 2000 }, pairCreatedAt: Date.now() - DAY }),
      pairOf(OK, { priceUsd: "5" }),
      // 1 real USDC in the pool against a fake billion-dollar valuation
      pairOf(FAKE, { priceUsd: "1", priceNative: "1", quoteToken: { address: USDC }, liquidity: { usd: 2e9, quote: 1 } }),
      pairOf(NFT, { priceUsd: "100" })
    ]
  };
  const fractions = [];
  const r = await scanner(w).analyzeWallet(W, { onProgress: (p, f) => fractions.push(f) });
  assert.equal(r.sol, 3);
  assert.equal(r.total, 6);
  assert.equal(r.hidden, 0);
  const by = Object.fromEntries(r.results.map((x) => [x.mint, x]));
  assert.equal(by[NFT], undefined);                // NFTs are dropped
  assert.equal(by[USDC].known, true);
  assert.equal(by[FAKE].value, 2);                 // valued at what can really be taken out
  assert.equal(by[FAKE].lights[2].items[0].code, "MKT_LIQ_INFLATED");
  assert.equal(by[NOMK].lvl, "NO_MARKET");
  // BAD: mint authority + tiny liquidity; FAKE: one red light (inflated liquidity) is medium
  assert.equal(by[BAD].lvl, "HIGH");
  assert.equal(by[FAKE].lvl, "MEDIUM");
  assert.deepEqual(r.results.map((x) => x.lvl), ["HIGH", "MEDIUM", "LOW", "LOW", "NO_MARKET"]);
  assert.ok(fractions.every((f, i) => i === 0 || f >= fractions[i - 1]), "progress never goes backwards");
  assert.equal(fractions[fractions.length - 1], 1);
});

test("analyzeWallet: empty wallet and dust threshold", async () => {
  const E = addr("empty"), W = addr("dusty"), T = addr("t");
  const s = scanner({ wallets: { [E]: { sol: 0, tokens: {} }, [W]: { sol: 0, tokens: { [T]: 1 } } }, mints: { [T]: { supply: 10, decimals: 0 } }, pairs: [pairOf(T, { priceUsd: "0.5" })] });
  const e = await s.analyzeWallet(E);
  assert.deepEqual([e.total, e.results.length], [0, 0]);
  assert.equal((await s.analyzeWallet(W)).hidden, 1);
  assert.equal((await s.analyzeWallet(W, { minUsd: 0 })).hidden, 0);
});

/* ---------- changes.js ---------- */

test("takeSnapshots + diffSnapshots across two checks", async () => {
  const W1 = addr("w1"), W2 = addr("w2"), A = addr("A"), B = addr("B"), DUST = addr("dust");
  const f = fakeChain({
    wallets: { [W1]: { tokens: { [A]: 100, [USDC]: 500, [WSOL]: 2, [DUST]: 1 } }, [W2]: { tokens: { [A]: 50 } } },
    pairs: [pairOf(A, { priceUsd: "2", baseToken: { address: A, symbol: "AAA" } }), pairOf(B, { priceUsd: "10", baseToken: { address: B, symbol: "BBB" } }), pairOf(DUST, { priceUsd: "0.1" })]
  });
  const c = createClient({ rpcUrl: OWN, fetch: f, retryDelayMs: 0 });
  const first = await takeSnapshots(c, [W1, W2]);
  assert.deepEqual(Object.keys(first.snapshots[W1]), [A]);   // stables, SOL and dust are left out
  assert.deepEqual(first.snapshots[W1][A], { q: 100, v: 200, s: "AAA" });
  const stored = {};
  for (const a of Object.keys(first.snapshots)) stored[a] = { ts: first.ts, h: first.snapshots[a] };

  // both wallets sell A and buy B
  f.world.wallets[W1].tokens = { [B]: 30 };
  f.world.wallets[W2].tokens = { [A]: 10, [B]: 10 };
  const d = diffSnapshots(stored, await takeSnapshots(c, [W1, W2]));
  assert.deepEqual(d.agg.buy.map((x) => [x.s, x.n, x.v]), [["BBB", 2, 400]]);
  assert.deepEqual(d.agg.sell.map((x) => [x.s, x.n, x.v]), [["AAA", 2, 280]]);
  assert.deepEqual(d.rows.find((r) => r.a === W1).ch.map((x) => x.k).sort(), ["new", "sold"]);
});

test("takeSnapshots aborts on partial price failures instead of reporting fake sales", async () => {
  const W = addr("w"), A = addr("A");
  await assert.rejects(takeSnapshots(client({ wallets: { [W]: { tokens: { [A]: 1 } } }, fail: { dex: true } }), [W]), (e) => e.code === "DEX_UNREACHABLE");
  await assert.rejects(takeSnapshots(client({ fail: { rpc: { getBalance: 400 } } }), [W]), (e) => e.code === "TOO_FEW_WALLETS");
});

/* ---------- confluence.js ---------- */

function groupWorld() {
  const W1 = addr("g1"), W2 = addr("g2"), W3 = addr("g3");
  const T1 = addr("T1"), T2 = addr("T2"), T3 = addr("T3"), DUST = addr("DUST"), NOMK = addr("NOMK");
  const POOL = addr("pool");
  const mk = (m) => ({ supply: 1000, decimals: 0 });
  return {
    W: [W1, W2, W3], T1, T2, T3, DUST, NOMK,
    wallets: {
      [W1]: { tokens: { [T1]: 10, [T2]: 10, [T3]: 10, [USDC]: 5, [DUST]: 1, [NOMK]: 1 } },
      [W2]: { tokens: { [T1]: 20, [T2]: 30, [USDC]: 5, [DUST]: 1, [NOMK]: 1 } },
      [W3]: { tokens: { [T1]: 5, [USDC]: 5 } }
    },
    mints: { [T1]: mk(), [T2]: mk(), [T3]: mk() },
    largest: { [T1]: [{ address: addr("l1"), amount: 900, owner: POOL }], [T2]: [{ address: addr("l2"), amount: 900, owner: POOL }] },
    owners: { [POOL]: AMM },
    pairs: [pairOf(T1, { priceUsd: "1" }), pairOf(T2, { priceUsd: "2" }), pairOf(T3, { priceUsd: "1" }), pairOf(USDC, { priceUsd: "1" }), pairOf(DUST, { priceUsd: "0.1" })]
  };
}

test("confluence: tokens held by enough of the group, with risk", async () => {
  const g = groupWorld();
  const r = await scanner(g).confluence(g.W, { pct: 50 });
  assert.equal(r.minN, 2);
  assert.equal(r.wallets, 3);
  assert.equal(r.noMarket, 1);
  assert.deepEqual(r.rows.map((x) => [x.mint, x.n]), [[g.T1, 3], [USDC, 3], [g.T2, 2]]);
  const t2 = r.rows[2];
  assert.equal(t2.total, 80);
  assert.deepEqual(t2.holders.map((h) => h.v), [60, 20]);
  assert.equal(r.rows[1].known, true);
  assert.ok(r.rows[0].lights);
  assert.deepEqual(r.notes, []);
  // stricter: everybody must hold it
  const all = await scanner(g).confluence(g.W, { pct: 100 });
  assert.deepEqual(all.rows.map((x) => x.mint).sort(), [g.T1, USDC].sort());
});

test("confluence: validation and the PnL filter without Helius", async () => {
  const g = groupWorld();
  const s = scanner(g);
  await assert.rejects(s.confluence([g.W[0]]), (e) => e.code === "TOO_FEW_WALLETS");
  await assert.rejects(s.confluence(g.W, { pnlFilter: "win" }), (e) => e.code === "HELIUS_REQUIRED");
  const r = await s.confluence(g.W, { withPnl: true });
  assert.deepEqual(r.notes, ["PNL_NO_HELIUS"]);
});

test("commonHolders: people in several tokens, bots dropped", async () => {
  const MA = addr("MA"), MB = addr("MB"), H1 = addr("H1"), H2 = addr("H2"), BOT = addr("BOTH");
  const s = scanner({
    mints: { [MA]: { supply: 100, decimals: 0 }, [MB]: { supply: 200, decimals: 0 } },
    largest: {
      [MA]: [{ address: addr("a1"), amount: 10, owner: H1 }, { address: addr("a2"), amount: 5, owner: H2 }, { address: addr("a3"), amount: 5, owner: BOT }],
      [MB]: [{ address: addr("b1"), amount: 50, owner: H1 }, { address: addr("b3"), amount: 20, owner: BOT }]
    },
    owners: { [H1]: SYSTEM_PROGRAM, [H2]: SYSTEM_PROGRAM, [BOT]: SYSTEM_PROGRAM },
    sigs: { [BOT]: sigsOver("bot", 200, 600) },
    pairs: [pairOf(MA, { baseToken: { address: MA, symbol: "AA" } })]
  });
  const r = await s.commonHolders([MA, MB, "not-an-address", MA]);
  assert.equal(r.tokens.length, 2);
  assert.equal(r.tokens[0].sym, "AA");
  assert.deepEqual(r.rows.map((x) => x.a), [H1]);
  assert.equal(r.rows[0].total, 35);
  assert.equal(r.dropped, 1);
  await assert.rejects(s.commonHolders([MA]), (e) => e.code === "TOO_FEW_TOKENS");
});

/* ---------- pnl.js ---------- */

function swap(sig, ts, me, changes, solChange) {
  return {
    signature: sig, timestamp: ts,
    accountData: [{ account: me, nativeBalanceChange: Math.round((solChange || 0) * 1e9), tokenBalanceChanges: Object.keys(changes).map((m) => ({ userAccount: me, mint: m, rawTokenAmount: { tokenAmount: String(changes[m] * 1e6), decimals: 6 } })) }]
  };
}

test("estimatePnl end to end with Helius swaps and SOL history", async () => {
  const W = addr("trader"), T = addr("T");
  const ts1 = 1_700_000_000, ts2 = ts1 + 86400, ts3 = ts2 + 86400;
  const s = scanner({
    wallets: { [W]: { tokens: { [T]: 50 } } },
    swaps: { [W]: [
      swap("s3", ts3, W, { [T]: -150 }, 2),                // sell 150 for 2 SOL @150 = $300
      swap("s2", ts2, W, { [T]: 100, [USDC]: -200 }),      // buy 100 for $200
      swap("s1", ts1, W, { [T]: 100 }, -1)                 // buy 100 for 1 SOL @100 = $100
    ] },
    solPrices: [[ts1 * 1000, 100], [ts2 * 1000, 120], [ts3 * 1000, 150]],
    pairs: [pairOf(T, { priceUsd: "3", baseToken: { address: T, symbol: "TT" } }), pairOf(WSOL, { priceUsd: "150" })]
  }, { heliusApiKey: "key" });
  const r = await s.estimatePnl([W]);
  const p = r.pnl[W];
  assert.equal(r.approx, false);
  assert.equal(p.n, 3);
  assert.equal(Math.round(p.realized), 100);
  assert.equal(Math.round(p.unreal), 50);
  assert.equal(p.st, "win");
  assert.equal(p.open[0].sym, "TT");
});

test("estimatePnl: Helius rejecting the key marks the rest as down; no SOL price is an error", async () => {
  const A = addr("a"), B = addr("b");
  const r = await scanner({ fail: { helius: 401 }, pairs: [pairOf(WSOL, { priceUsd: "150" })] }, { heliusApiKey: "bad" }).estimatePnl([A, B], { balances: {} });
  assert.equal(r.down, true);
  assert.deepEqual(r.pnl, { [A]: null, [B]: null });
  assert.equal(r.approx, true);
  await assert.rejects(scanner({}, { heliusApiKey: "k" }).estimatePnl([A], { balances: {} }), (e) => e.code === "SOL_PRICE");
});

test("fetchSwaps pages through history up to the limit", async () => {
  const W = addr("pager");
  const list = Array.from({ length: 250 }, (_, i) => ({ signature: "sw" + i }));
  const f = fakeChain({ swaps: { [W]: list } });
  const c = createClient({ rpcUrl: OWN, fetch: f, heliusApiKey: "k", retryDelayMs: 0 });
  assert.equal((await fetchSwaps(c, W, 300)).length, 250);
  assert.equal(f.calls.length, 3);
  assert.equal((await fetchSwaps(c, W, 100)).length, 100);
  assert.ok(f.calls.every((x) => x.url.includes("api-key=k")));
});

test("creator track record: older launches that never took off", async () => {
  const w = riskWorld({}, { pairCreatedAt: Date.now() - 2 * DAY });
  const ago = (h) => new Date(Date.now() - h * 3600000).toISOString();
  const toks = [{ mint: w.M, createdAt: ago(1), marketCap: 3000 }, { mint: "N", createdAt: ago(2), marketCap: 3000 }, { mint: "X", createdAt: ago(40) }];
  for (let i = 0; i < 11; i++) toks.push({ mint: "O" + i, createdAt: ago(30 + i * 24), marketCap: i === 0 ? 85000 : 2900 + i });
  w.rugcheck = { [w.M]: { report: { creator: "Farm1", creatorTokens: toks } } };
  const r = await scanner(w).analyzeToken(w.M);
  assert.deepEqual(r.creator, { creator: "Farm1", day: 1, total: 13, old: 11, dead: 10, best: 85000 });
  const s = r.lights[0].items.find((x) => x.code === "CTL_CREATOR_HISTORY");
  assert.deepEqual(s, { code: "CTL_CREATOR_HISTORY", s: "bad", data: { old: 11, dead: 10, best: 85000, creator: "Farm1" } });
});
