import test from "node:test";
import assert from "node:assert/strict";
import { createScanner, describe, perHour, groupList, SYSTEM_PROGRAM } from "../src/index.js";
import { fakeChain, addr, pairOf, sigsOver } from "./fakechain.js";

const OWN = "https://rpc.example.test/";
const NOW = 1_800_000_000_000;
const M = addr("wm-mint");
const P1 = addr("wm-p1"), P2 = addr("wm-p2"), B1 = addr("wm-b1"), B2 = addr("wm-b2"), POOL = addr("wm-pool");
const DIST = addr("wm-dist"), TEAM = addr("wm-team");

// P1+P2 (people) were funded by DIST, a distributor doing ~50 transactions an hour. B1+B2 trade all day
// (bots) and were both funded by TEAM: on a young token that is the team's split hiding among traders.
function world(age, o) {
  o = o || {};
  const few = (p) => [{ signature: p + "-first", blockTime: 1_790_000_000 }];
  return {
    mints: { [M]: { supply: 1000, decimals: 0 } },
    largest: { [M]: [
      { address: addr("wm-t1"), amount: 60, owner: P1 },
      { address: addr("wm-t2"), amount: 50, owner: P2 },
      { address: addr("wm-t3"), amount: 70, owner: B1 },
      { address: addr("wm-t4"), amount: 40, owner: B2 },
      { address: addr("wm-t5"), amount: 400, owner: POOL }
    ] },
    owners: { [P1]: SYSTEM_PROGRAM, [P2]: SYSTEM_PROGRAM, [B1]: SYSTEM_PROGRAM, [B2]: SYSTEM_PROGRAM,
      [POOL]: "AmmProgram11111111111111111111111111111111" },
    sigs: {
      [P1]: few("wm-p1"), [P2]: few("wm-p2"),
      [B1]: sigsOver("wm-b1", 300, 3600 * 5, 1_799_000_000), [B2]: sigsOver("wm-b2", 300, 3600 * 5, 1_799_000_000),
      [DIST]: sigsOver("wm-dist", 1000, 3600 * 20, 1_799_000_000),   // 50 an hour
      [TEAM]: sigsOver("wm-team", 20, 3600 * 20, 1_799_000_000)
    },
    txs: { "wm-p1-first": DIST, "wm-p2-first": DIST, "wm-b1-299": TEAM, "wm-b2-299": TEAM },
    pairs: o.noPair ? [] : [pairOf(M, { pairCreatedAt: NOW - age * 86400000 })],
    rugcheck: o.detectedAt ? { [M]: { report: { detectedAt: new Date(o.detectedAt).toISOString() } } } : {}
  };
}

test("young token: busy wallets are traced too, the team's split shows up and warns in red", async () => {
  const s = createScanner({ rpcUrl: OWN, fetch: fakeChain(world(3)), retryDelayMs: 0 });
  const h = await s.analyzeHolders(M, { creator: false, now: NOW });
  assert.equal(h.mode, "young");
  assert.equal(Math.round(h.ageDays), 3);
  assert.equal(h.clusters[B1].funder, TEAM);
  assert.equal(h.clusters[P1].funder, DIST);              // a 50-an-hour distributor is not taken for an exchange
  assert.deepEqual(h.groups.map((g) => [g.members.length, Math.round(g.pct)]), [[2, 11], [2, 11]]);
  assert.equal(h.signals.length, 1);
  assert.equal(h.signals[0].code, "HOLD_GROUP");
  assert.equal(h.signals[0].s, "bad");
  assert.match(describe(h.signals[0], "es"), /^2 holders recibieron su primer SOL de la misma wallet y juntos tienen el 11%/);
});

test("mature token: only people are traced; a group must pass 15% to warn, in yellow", async () => {
  const s = createScanner({ rpcUrl: OWN, fetch: fakeChain(world(90)), retryDelayMs: 0 });
  const h = await s.analyzeHolders(M, { creator: false, now: NOW });
  assert.equal(h.mode, "mature");
  assert.equal(h.clusters[B1], undefined);
  assert.equal(h.groups.length, 1);
  assert.deepEqual(h.signals, []);
  const w = world(90);
  w.largest[M][1].amount = 150;                            // P1+P2 now hold 21%
  const h2 = await createScanner({ rpcUrl: OWN, fetch: fakeChain(w), retryDelayMs: 0 }).analyzeHolders(M, { creator: false, now: NOW });
  assert.deepEqual(h2.signals.map((x) => [x.code, x.s, Math.round(x.data.pct)]), [["HOLD_GROUP", "warn", 21]]);
});

test("without a market the age comes from RugCheck; with neither it counts as mature", async () => {
  const s = createScanner({ rpcUrl: OWN, fetch: fakeChain(world(0, { noPair: true, detectedAt: NOW - 2 * 86400000 })), retryDelayMs: 0 });
  const h = await s.analyzeHolders(M, { creator: false, now: NOW });
  assert.equal(h.mode, "young");
  const s2 = createScanner({ rpcUrl: OWN, fetch: fakeChain(world(0, { noPair: true })), retryDelayMs: 0 });
  const h2 = await s2.analyzeHolders(M, { creator: false, now: NOW });
  assert.equal(h2.mode, "mature");
  assert.equal(h2.ageDays, null);
});

test("perHour and groupList", () => {
  assert.equal(perHour(sigsOver("x", 101, 3600)), 101);
  assert.equal(perHour([]), 0);
  const rows = [{ owner: "a", pct: 5 }, { owner: "b", pct: 4 }, { owner: "c", pct: 9 }, { owner: "d", pct: 1 }];
  assert.deepEqual(groupList({ a: { id: "A", funder: "F" }, b: { id: "A", funder: "F" }, c: { id: "B", funder: "G" }, d: { id: "B", funder: "G" } }, rows),
    [{ id: "A", funder: "F", members: ["a", "b"], pct: 9 }, { id: "B", funder: "G", members: ["c", "d"], pct: 10 }].sort((x, y) => y.pct - x.pct));
});
