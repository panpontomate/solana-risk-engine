import test from "node:test";
import assert from "node:assert/strict";
import { createScanner, createClient, findFunder, markBusy, rugcheckGraph, netBalances, SYSTEM_PROGRAM } from "../src/index.js";
import { fakeChain, addr, pairOf, sigsOver } from "./fakechain.js";

const OWN = "https://rpc.example.test/";
const M = addr("mint");
const P1 = addr("p1"), P2 = addr("p2"), P3 = addr("p3"), P4 = addr("p4"), BOT = addr("bot"), POOL = addr("pool");
const FUNDER = addr("funder"), EXCH = addr("exchange"), CREATOR = addr("creator");
const N1 = addr("n1"), N2 = addr("n2"), POOLAUTH = addr("poolauth");
const X1 = addr("x1"), X2 = addr("x2");

// A token where: P1+P2 were funded by the same wallet (one team), P3+P4 were funded by an exchange
// hot wallet (strangers), BOT trades nonstop, POOL is an AMM vault, and RugCheck knows the creator.
function world() {
  const few = (p) => [{ signature: p + "-first", blockTime: 1_700_000_000 }];
  return {
    mints: { [M]: { supply: 1000, decimals: 0 } },
    largest: { [M]: [
      { address: addr("ta1"), amount: 300, owner: P1 },
      { address: addr("ta4"), amount: 250, owner: POOL },
      { address: addr("ta2"), amount: 200, owner: P2 },
      { address: addr("ta3"), amount: 100, owner: P3 },
      { address: addr("ta5"), amount: 50, owner: BOT },
      { address: addr("ta7"), amount: 30, owner: P4 },
      { address: addr("ta6"), amount: 20, owner: P1 }
    ] },
    owners: {
      [P1]: SYSTEM_PROGRAM, [P2]: SYSTEM_PROGRAM, [P3]: SYSTEM_PROGRAM, [P4]: SYSTEM_PROGRAM, [BOT]: SYSTEM_PROGRAM,
      [POOL]: "AmmProgram11111111111111111111111111111111", [POOLAUTH]: "AmmProgram11111111111111111111111111111111",
      [FUNDER]: SYSTEM_PROGRAM, [EXCH]: SYSTEM_PROGRAM
    },
    wallets: { [N1]: { sol: 0, tokens: { [M]: 40 } }, [N2]: { sol: 0, tokens: {} } },
    sigs: {
      [P1]: few("p1"), [P2]: few("p2"), [P3]: few("p3"), [P4]: few("p4"),
      [BOT]: sigsOver("bot", 200, 86400),        // 200 transactions in one day: a bot
      [EXCH]: sigsOver("ex", 200, 3600),         // the exchange hot wallet is even busier
      [FUNDER]: few("f")
    },
    txs: { "p1-first": FUNDER, "p2-first": FUNDER, "p3-first": EXCH, "p4-first": EXCH },
    pairs: [pairOf(M, { baseToken: { address: M, symbol: "WHL", name: "Whale" }, priceUsd: "2" })],
    rugcheck: {
      [M]: {
        report: {
          creator: CREATOR, creatorBalance: 5, rugged: true, launchpad: { name: "pump.fun" }, token: { supply: 1000 },
          insiderNetworks: [{ size: 3 }],
          creatorTokens: [{ mint: X1, createdAt: "2026-01-01" }, { mint: M, createdAt: "2026-06-01" }, { mint: X2, createdAt: "2026-05-01" }]
        },
        graph: [
          { nodes: [{ id: N1, holdings: 100 }, { id: N2, holdings: 50 }, { id: POOLAUTH, holdings: 10 }, { id: addr("ghost"), participant: false }] },
          { nodes: [{ id: addr("lonely"), holdings: 1 }] }
        ]
      },
      [X1]: { summary: { score: 9000, lpLockedPct: 0 } }
    }
  };
}

test("analyzeHolders: rows, bots, funder groups, exchange sources and creator", async () => {
  const f = fakeChain(world());
  const s = createScanner({ rpcUrl: OWN, fetch: f, retryDelayMs: 0 });
  const steps = new Set();
  const h = await s.analyzeHolders(M, { onProgress: (p) => steps.add(p.step) });

  assert.equal(h.sym, "WHL");
  assert.equal(h.price, 2);
  // P1's two token accounts are summed; rows sorted by % of supply
  assert.deepEqual(h.rows.map((r) => [r.owner, Math.round(r.pct * 1000) / 1000]),[[P1, 32], [POOL, 25], [P2, 20], [P3, 10], [BOT, 5], [P4, 3]]);
  assert.equal(h.rows[0].value, 640);
  assert.equal(h.rows[1].kind, "program");
  const bot = h.rows.find((r) => r.owner === BOT);
  assert.equal(bot.kind, "active");
  assert.equal(bot.busy, 24);

  // same funder -> one group; the exchange-funded pair is not a group
  assert.equal(h.clusters[P1].id, h.clusters[P2].id);
  assert.equal(h.clusters[P1].funder, FUNDER);
  assert.equal(h.clusters[P3], undefined);
  assert.equal(h.clusters[P4], undefined);
  assert.equal(h.hotGroups, 1);

  // creator history from RugCheck, newest other tokens first, the token itself excluded
  assert.equal(h.creator.addr, CREATOR);
  assert.equal(h.creator.rugged, true);
  assert.equal(h.creator.launchpad, "pump.fun");
  assert.deepEqual(h.creator.others.map((t) => t.mint), [X2, X1]);
  assert.equal(h.creator.checked, 2);
  assert.equal(h.creator.riskMap[X1].score, 9000);
  assert.equal(h.creator.riskMap[X2], null);

  // insider networks: single-node network dropped, non-participants dropped, pool balance not counted
  assert.equal(h.creator.graph.length, 1);
  const net = h.creator.graph[0];
  assert.equal(net.checked, true);
  assert.equal(net.now, 40);
  assert.deepEqual(net.nodes.map((n) => [n.addr, n.kind, n.now]), [[N1, "wallet", 40], [N2, "wallet", 0], [POOLAUTH, "program", 0]]);

  for (const st of ["token", "owners", "kinds", "bots", "funders", "exchangeSources", "creator", "networks", "done"]) assert.ok(steps.has(st), st);
});

test("analyzeHolders without creator lookup and with RugCheck down", async () => {
  const wd = world();
  wd.rugcheck = {};
  const s = createScanner({ rpcUrl: OWN, fetch: fakeChain(wd), retryDelayMs: 0 });
  assert.equal((await s.analyzeHolders(M)).creator, null);
  const f = fakeChain(world());
  const h = await createScanner({ rpcUrl: OWN, fetch: f, retryDelayMs: 0 }).analyzeHolders(M, { creator: false });
  assert.equal(h.creator, null);
  assert.ok(!f.calls.some((c) => c.url.includes("rugcheck")));
});

test("analyzeHolders errors", async () => {
  const s = createScanner({ rpcUrl: OWN, fetch: fakeChain(world()), retryDelayMs: 0 });
  await assert.rejects(s.analyzeHolders("nope"), (e) => e.code === "INVALID_ADDRESS");
  await assert.rejects(s.analyzeHolders(P1), (e) => e.code === "NOT_A_TOKEN");
  const wd = world();
  wd.largest[M] = [];
  await assert.rejects(createScanner({ rpcUrl: OWN, fetch: fakeChain(wd), retryDelayMs: 0 }).analyzeHolders(M), (e) => e.code === "NO_HOLDERS");
});

test("findFunder walks up to 3 pages of signatures and gives up on very active wallets", async () => {
  const A = addr("a"), B = addr("b"), C = addr("c"), D = addr("d");
  const f = fakeChain({
    sigs: { [A]: sigsOver("a", 2500, 1e6), [B]: sigsOver("b", 3500, 1e6), [C]: [{ signature: "c-0" }], [D]: [] },
    txs: { "a-2499": FUNDER, "c-0": C }
  });
  const c = createClient({ rpcUrl: OWN, fetch: f, retryDelayMs: 0 });
  assert.equal(await findFunder(c, A), FUNDER);    // oldest signature of the third page
  assert.equal(await findFunder(c, B), null);      // more than 3000: unreliable, no guess
  assert.equal(await findFunder(c, C), null);      // paid for itself
  assert.equal(await findFunder(c, D), null);      // no history
  assert.equal(f.calls.filter((x) => x.method === "getSignaturesForAddress" && x.params[0] === A).length, 3);
});

test("markBusy only flags 200 signatures within 2 days", async () => {
  const slow = addr("slow"), fast = addr("fast"), few = addr("few");
  const c = createClient({ rpcUrl: OWN, fetch: fakeChain({ sigs: { [slow]: sigsOver("s", 200, 5 * 86400), [fast]: sigsOver("f", 200, 7200), [few]: sigsOver("w", 50, 60) } }), retryDelayMs: 0 });
  const kind = { [slow]: "wallet", [fast]: "wallet", [few]: "wallet" };
  const busy = await markBusy(c, kind, [slow, fast, few]);
  assert.deepEqual(busy, { [fast]: 2 });
  assert.equal(kind[fast], "active");
  assert.equal(kind[slow], "wallet");
});

test("rugcheckGraph and netBalances tolerate missing data", async () => {
  const c = createClient({ rpcUrl: OWN, fetch: fakeChain({}), retryDelayMs: 0 });
  assert.equal(await rugcheckGraph(c, M), null);
  // a wallet whose balance cannot be read leaves the network unchecked
  const failing = createClient({ rpcUrl: OWN, fetch: fakeChain({ fail: { rpc: { getTokenAccountsByOwner: 400 } }, owners: { [N1]: SYSTEM_PROGRAM, [N2]: SYSTEM_PROGRAM } }), retryDelayMs: 0 });
  const g = [{ nodes: [{ addr: N1, hold: 5 }, { addr: N2, hold: 1 }], hold: 6 }];
  await netBalances(failing, M, g);
  assert.equal(g[0].checked, false);
  assert.equal(g[0].nodes[0].now, null);
});
