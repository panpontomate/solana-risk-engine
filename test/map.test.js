import test from "node:test";
import assert from "node:assert/strict";
import { createClient, connectionMap, perHour, walletType, mapGroups, topHub, mapSignals, allHolders,
  EXCHANGE_PER_HOUR, MAP_HUB, SYSTEM_PROGRAM, TOKEN_PROGRAM, createScanner, describe } from "../src/index.js";
import { fakeChain, addr, pairOf, sigsOver } from "./fakechain.js";

const OWN = "https://rpc.example.test/";
const NOW = 1_800_000_000_000;
const M = addr("map-mint");
const P1 = addr("m-p1"), P2 = addr("m-p2"), P3 = addr("m-p3"), BOT = addr("m-bot"), POOL = addr("m-pool"), BIG = addr("m-big");
const DIST = addr("m-dist"), EXCH = addr("m-exch"), CREATOR = addr("m-creator"), LAUNCHER = addr("m-launcher");
const HUB = addr("m-hub");

// P1+P2 got their first SOL from DIST, a distributor doing ~50 transactions an hour (well under an
// exchange); P3 from an exchange hot wallet; BOT trades all day; POOL is an AMM; RugCheck has a
// transfer network where HUB handed tokens to 25 wallets.
function world(o) {
  o = o || {};
  const few = (p) => [{ signature: p + "-first", blockTime: 1_790_000_000 }];
  const netNodes = [{ id: HUB, holdings: 5 }].concat(Array.from({ length: 25 }, (_, i) => ({ id: addr("m-r" + i), holdings: 1 })));
  return {
    mints: { [M]: { supply: 1000, decimals: 0 } },
    largest: { [M]: [
      { address: addr("m-ta1"), amount: 80, owner: P1 },
      { address: addr("m-ta2"), amount: 70, owner: P2 },
      { address: addr("m-ta3"), amount: 300, owner: POOL },
      { address: addr("m-ta4"), amount: 50, owner: P3 },
      { address: addr("m-ta5"), amount: 40, owner: BOT },
      { address: addr("m-ta6"), amount: 120, owner: BIG }
    ] },
    owners: { [P1]: SYSTEM_PROGRAM, [P2]: SYSTEM_PROGRAM, [P3]: SYSTEM_PROGRAM, [BOT]: SYSTEM_PROGRAM, [BIG]: SYSTEM_PROGRAM,
      [POOL]: "AmmProgram11111111111111111111111111111111" },
    sigs: Object.assign({
      [P1]: few("m-p1"), [P2]: few("m-p2"), [P3]: few("m-p3"), [BIG]: few("m-big"),
      [BOT]: sigsOver("m-bot", 300, 3600 * 10, 1_799_000_000),     // 30 an hour: a bot, not an exchange
      [DIST]: sigsOver("m-dist", 1000, 3600 * 20, 1_799_000_000),  // 50 an hour
      [EXCH]: sigsOver("m-exch", 1000, 3600, 1_799_000_000),       // 1000 an hour
      [M]: [{ signature: "m-create", blockTime: 1_790_000_000 }]
    }, o.sigs || {}),
    txs: { "m-p1-first": DIST, "m-p2-first": DIST, "m-p3-first": EXCH, "m-big-first": BIG, "m-create": LAUNCHER, "m-bot-299": DIST },
    pairs: [pairOf(M)],
    rugcheck: { [M]: {
      report: { creator: CREATOR, detectedAt: new Date(o.createdAt || NOW - 3 * 86400000).toISOString(), token: { supply: 1000 } },
      graph: [{ network_type: "transfer", nodes: netNodes, links: netNodes.slice(1).map((n) => ({ source: HUB, target: n.id })) }]
    } }
  };
}

test("perHour and walletType: exchanges only above 350 an hour", () => {
  assert.equal(perHour(sigsOver("x", 101, 3600)), 101);
  assert.equal(perHour([]), 0);
  assert.equal(walletType("program", 0), "pool");
  assert.equal(walletType("wallet", EXCHANGE_PER_HOUR + 1), "exchange");
  assert.equal(walletType("wallet", 54), "bot");          // busy, but a person-run distributor is not an exchange
  assert.equal(walletType("active", 1), "bot");
  assert.equal(walletType("wallet", 1), "person");
});

test("a young token: everyone is traced, a distributor's holders form a group, the hub and the group warn", async () => {
  const c = createClient({ rpcUrl: OWN, fetch: fakeChain(world()), retryDelayMs: 0 });
  const m = await connectionMap(c, M, { now: NOW, max: 20 });
  assert.equal(m.mode, "young");
  assert.equal(Math.round(m.ageDays), 3);
  const by = Object.fromEntries(m.holders.map((h) => [h.addr, h]));
  assert.deepEqual(m.holders.map((h) => h.addr), [POOL, P1, P2, BIG, P3, BOT].sort((a, b) => by[b].pct - by[a].pct));
  assert.equal(by[POOL].type, "pool");
  assert.equal(by[BOT].type, "bot");
  assert.equal(by[P1].funder, DIST);
  assert.equal(by[BIG].funder, undefined);                 // paid for itself
  assert.equal(by[BOT].funder, DIST);                      // young: bots are traced too
  assert.equal(m.sources[DIST].type, "person");
  assert.equal(m.sources[EXCH].type, "exchange");
  assert.equal(m.groups.length, 1);
  assert.deepEqual(m.groups[0].members.sort(), [P1, P2, BOT].sort());
  assert.equal(m.groups[0].id, "A");
  assert.equal(Math.round(m.groups[0].pct), 19);
  assert.equal(m.nets.length, 1);
  assert.equal(m.nets[0].links.length, 25);
  assert.equal(m.nets[0].nodes[0].pct, 0.5);
  assert.deepEqual(m.hub, { addr: HUB, out: 25 });
  assert.equal(m.creator, CREATOR);
  assert.equal(m.payer, LAUNCHER);
  assert.deepEqual(m.signals.map((s) => [s.code, s.s]), [["MAP_GROUP", "bad"], ["MAP_HUB", "bad"]]);
  assert.match(describe(m.signals[1], "es"), /^Una wallet ha repartido tokens a 25 wallets/);
  assert.match(describe(m.signals[0], "en"), /^3 holders got their first SOL from the same wallet and together hold 19%/);
});

test("a mature token: only people are traced and grouped; a single person over 10% warns", async () => {
  const c = createClient({ rpcUrl: OWN, fetch: fakeChain(world({ createdAt: NOW - 90 * 86400000 })), retryDelayMs: 0 });
  const m = await connectionMap(c, M, { now: NOW, max: 20 });
  assert.equal(m.mode, "mature");
  const by = Object.fromEntries(m.holders.map((h) => [h.addr, h]));
  assert.equal(by[BOT].funder, undefined);
  assert.deepEqual(m.groups[0].members.sort(), [P1, P2].sort());
  assert.equal(m.payer, null);
  // group 15% is not over the mature limit; BIG holds 12%
  assert.deepEqual(m.signals.map((s) => [s.code, s.s, Math.round(s.data.pct)]), [["MAP_WHALE", "warn", 12]]);
});

test("createdAt from the market wins over RugCheck's date", async () => {
  const c = createClient({ rpcUrl: OWN, fetch: fakeChain(world({ createdAt: NOW - 90 * 86400000 })), retryDelayMs: 0 });
  const m = await connectionMap(c, M, { now: NOW, max: 20, createdAt: NOW - 86400000 });
  assert.equal(m.mode, "young");
});

test("with your own RPC it reads every account (up to 75), not just the RPC's top 20", async () => {
  const w = world();
  w.allAccounts = { [M]: Array.from({ length: 90 }, (_, i) => ({ address: addr("m-acc" + i), amount: 1000 - i, owner: addr("m-own" + (i % 80)) })) };
  const c = createClient({ rpcUrl: OWN, fetch: fakeChain(w), retryDelayMs: 0 });
  const rows = await allHolders(c, M, TOKEN_PROGRAM, 75);
  assert.equal(rows.length, 75);
  assert.equal(rows[0].owner, addr("m-own0"));
  assert.equal(rows[0].raw, 1000 + 920);                   // accounts 0 and 80 share an owner
  assert.ok(rows.every((r, i) => !i || rows[i - 1].raw >= r.raw));
});

test("pure helpers: groups skip exchanges, hub, signals per mode", () => {
  const hs = [{ addr: "a", pct: 6, type: "person", funder: "F" }, { addr: "b", pct: 5, type: "bot", funder: "F" }, { addr: "c", pct: 1, type: "person", funder: "X" }, { addr: "d", pct: 1, type: "person", funder: "X" }];
  const src = { F: { rate: 10, type: "person" }, X: { rate: 900, type: "exchange" } };
  assert.deepEqual(mapGroups(hs, src, "young").map((g) => [g.id, g.members.length, g.pct]), [["A", 2, 11]]);
  assert.deepEqual(mapGroups(hs, src, "mature"), []);
  assert.deepEqual(topHub([{ links: [["h", "1"], ["h", "2"], ["x", "3"]] }]), { addr: "h", out: 2 });
  assert.deepEqual(mapSignals({ mode: "young", groups: [{ members: ["a", "b"], pct: 11, funder: "F" }], hub: { addr: "h", out: MAP_HUB - 1 }, holders: [] }).map((s) => s.code), ["MAP_GROUP"]);
  assert.deepEqual(mapSignals({ mode: "mature", groups: [{ members: ["a", "b"], pct: 11 }], hub: { addr: "h", out: 99 }, holders: [] }), []);
});

test("whales: a distributor doing ~50 transactions an hour now forms a group (it used to be taken for an exchange)", async () => {
  const s = createScanner({ rpcUrl: OWN, fetch: fakeChain(world()), retryDelayMs: 0 });
  const h = await s.analyzeHolders(M, { creator: false });
  assert.equal(h.clusters[P1] && h.clusters[P1].funder, DIST);
  assert.equal(h.clusters[P2].id, h.clusters[P1].id);
  assert.equal(h.hotGroups, 0);
});
