import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateKeyPairSync, createHash } from "node:crypto";
import {
  createClient, createScanner, levelFrom, b58bytes, onCurve, isOnCurve, describe, describeError, describeStep, typeInfo,
  levelLabel, lightLabel, LEVELS, TYPES, LIGHTS, SYSTEM_PROGRAM, rugcheckSummary
} from "../src/index.js";
import es from "../src/i18n/es.js";
import en from "../src/i18n/en.js";
import { b58encode, addr } from "./fakechain.js";

const OWN = "https://rpc.example.test/";
const ok = (json) => ({ status: 200, ok: true, json: async () => json });
const status = (s) => ({ status: s, ok: false, json: async () => ({}) });

/* ---------- client.js ---------- */

test("JSON-RPC errors become RPC ScanErrors without retries", async () => {
  let n = 0;
  const c = createClient({ rpcUrl: OWN, fetch: async () => { n++; return ok({ error: { code: -32602, message: "Invalid param" } }); }, retryDelayMs: 0 });
  await assert.rejects(c.rpc("getBalance", ["x"]), (e) => e.code === "RPC" && e.message === "Invalid param" && e.data.rpcCode === -32602);
  assert.equal(n, 1);
});

test("4xx is not retried, 5xx and network errors are", async () => {
  let n = 0;
  await assert.rejects(createClient({ rpcUrl: OWN, fetch: async () => { n++; return status(404); }, retryDelayMs: 0 }).rpc("x", []), (e) => e.code === "HTTP" && e.data.status === 404);
  assert.equal(n, 1);
  n = 0;
  await assert.rejects(createClient({ rpcUrl: OWN, fetch: async () => { n++; throw new TypeError("fetch failed"); }, retryDelayMs: 0 }).rpc("x", []), (e) => e.code === "NETWORK");
  assert.equal(n, 4);
  // recovers when a retry succeeds
  n = 0;
  const c = createClient({ rpcUrl: OWN, fetch: async () => (++n < 3 ? status(503) : ok({ result: 42 })), retryDelayMs: 0 });
  assert.equal(await c.rpc("x", []), 42);
  assert.equal(n, 3);
});

test("retry waits double each time", async () => {
  const times = [];
  const c = createClient({ rpcUrl: OWN, fetch: async () => { times.push(Date.now()); return status(500); }, retryDelayMs: 20 });
  await assert.rejects(c.rpc("x", []));
  const gaps = times.slice(1).map((t, i) => t - times[i]);
  assert.ok(gaps[0] >= 15 && gaps[1] >= 35 && gaps[2] >= 75, "gaps " + gaps);
});

test("aborting in the middle of a request cancels it", async () => {
  const ctrl = new AbortController();
  const f = (url, init) => new Promise((res, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted"))));
  const c = createClient({ rpcUrl: OWN, fetch: f, signal: ctrl.signal });
  const p = c.rpc("getBalance", ["x"]);
  setTimeout(() => ctrl.abort(), 10);
  await assert.rejects(p, (e) => e.code === "CANCELLED");
});

test("aborting cancels a whole wallet analysis", async () => {
  const ctrl = new AbortController();
  let calls = 0;
  const f = async (url, init) => {
    calls++;
    if (calls === 2) ctrl.abort();
    return ok({ result: { value: [] } });
  };
  const s = createScanner({ rpcUrl: OWN, fetch: f, signal: ctrl.signal });
  await assert.rejects(s.analyzeWallet(addr("w")), (e) => e.code === "CANCELLED");
});

test("softJson: optional extras return null on errors and timeouts, but still honour cancel", async () => {
  const c = createClient({ fetch: async () => status(500) });
  assert.equal(await c.softJson("https://x", 50), null);
  const slow = createClient({ fetch: (url, init) => new Promise((res, rej) => init.signal.addEventListener("abort", () => rej(new Error("timeout")))) });
  const t0 = Date.now();
  assert.equal(await slow.softJson("https://x", 30), null);
  assert.ok(Date.now() - t0 < 1000);
  const ctrl = new AbortController();
  const c2 = createClient({ fetch: (url, init) => new Promise((res, rej) => init.signal.addEventListener("abort", () => rej(new Error("x")))), signal: ctrl.signal });
  const p = c2.softJson("https://x", 5000);
  setTimeout(() => ctrl.abort(), 10);
  await assert.rejects(p, (e) => e.code === "CANCELLED");
});

test("the free Vibe Station queue spaces requests", async () => {
  const times = [];
  const c = createClient({ fetch: async () => { times.push(Date.now()); return ok({ result: { value: [] } }); }, vibeIntervalMs: 60 });
  await Promise.all([c.rpc("getTokenLargestAccounts", ["a"]), c.rpc("getTokenLargestAccounts", ["b"]), c.rpc("getTokenLargestAccounts", ["c"])]);
  times.sort();
  assert.ok(times[1] - times[0] >= 50 && times[2] - times[1] >= 50, "gaps " + (times[1] - times[0]) + "," + (times[2] - times[1]));
});

test("createClient needs a fetch", () => {
  const saved = globalThis.fetch;
  try {
    globalThis.fetch = undefined;
    assert.throws(() => createClient({}), /no fetch/);
  } finally { globalThis.fetch = saved; }
});

/* ---------- curve.js against real cryptography ---------- */

test("real ed25519 public keys are always on the curve", () => {
  for (let i = 0; i < 64; i++) {
    const raw = generateKeyPairSync("ed25519").publicKey.export({ format: "der", type: "spki" }).subarray(-32);
    const a = b58encode([...raw]);
    assert.deepEqual(b58bytes(a), [...raw], "base58 round trip");
    assert.equal(isOnCurve(a), true, a);
  }
});

test("random 32-byte hashes are off the curve about half the time (as PDAs rely on)", () => {
  let off = 0;
  const N = 400;
  for (let i = 0; i < N; i++) if (!onCurve([...createHash("sha256").update("seed" + i).digest()])) off++;
  assert.ok(off > N * 0.35 && off < N * 0.65, "off-curve " + off + "/" + N);
});

test("System Program and other well-known ids decode to 32 bytes", () => {
  assert.equal(b58bytes(SYSTEM_PROGRAM).length, 32);
  for (const k of ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA", "So11111111111111111111111111111111111111112"]) {
    assert.equal(b58encode(b58bytes(k)), k);
  }
});

/* ---------- levelFrom properties over every combination of lights ---------- */

test("levelFrom over all 256 combinations of four lights", () => {
  const S = ["ok", "na", "warn", "bad"], RANK = { LOW: 0, MEDIUM: 1, HIGH: 2 };
  const all = [];
  for (let i = 0; i < 256; i++) all.push([0, 1, 2, 3].map((k) => ({ s: S[(i >> (2 * k)) & 3] })));
  for (const ls of all) {
    const c = (s) => ls.filter((l) => l.s === s).length, b = c("bad"), w = c("warn"), na = c("na");
    const r = levelFrom(ls);
    if (b >= 2 || (b === 1 && w >= 1)) assert.equal(r.lvl, "HIGH");
    else if (b === 1 || w >= 2 || na > 0) assert.equal(r.lvl, "MEDIUM");
    else assert.equal(r.lvl, "LOW");
    // making any light worse never lowers the level or the severity
    ls.forEach((l, k) => {
      const worse = S.indexOf(l.s) + 1;
      // ok -> na is "less known", not "worse"; and by design one unchecked light (na) weighs more
      // than one warning: a single yellow light can still be LOW, a missing check never is
      if (worse > 3 || l.s === "ok" || l.s === "na") return;
      const ls2 = ls.map((x, j) => (j === k ? { s: S[worse] } : x));
      const r2 = levelFrom(ls2);
      assert.ok(RANK[r2.lvl] >= RANK[r.lvl], JSON.stringify(ls) + " -> " + JSON.stringify(ls2));
      assert.ok(r2.sev >= r.sev);
    });
  }
});

/* ---------- i18n completeness ---------- */

const src = (f) => readFileSync(new URL("../src/" + f, import.meta.url), "utf8");
const emitted = new Set();
for (const f of ["risk.js", "wallet.js"]) for (const m of src(f).matchAll(/(?:sig\(|code: )"([A-Z_0-9]+)"/g)) emitted.add(m[1]);
// codes chosen with a ternary are not caught by the regex above
["CON_ALL_POOLS", "CON_OK", "CON_HIGH", "CTL_ONLY_PROGRAMS", "CTL_NONE"].forEach((c) => emitted.add(c));

test("every signal the engine can emit has a Spanish and an English text", () => {
  assert.ok(emitted.size >= 35, "found " + emitted.size + " codes");
  for (const code of emitted) {
    assert.equal(typeof es.signals[code], "function", "es missing " + code);
    assert.equal(typeof en.signals[code], "function", "en missing " + code);
  }
});

test("Spanish and English have exactly the same keys", () => {
  for (const section of ["signals", "levels", "types", "lights", "missing", "steps", "notes", "errors"]) {
    assert.deepEqual(Object.keys(es[section]).sort(), Object.keys(en[section]).sort(), section);
  }
});

const SAMPLE = { byWallet: true, ext: "transferHook", symbol: "BONK", real: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", w1: 12.3, w10: 45.6, prog: 30, top1: 50, top10: 70,
  reported: 4e9, real_: 2, liq: 12345, vol: 0.004, days: 3, pct: 7.5, n: 1, total: 4, filter: "win", message: "boom" };

test("every text renders without throwing, placeholders or 'undefined'", () => {
  for (const L of [es, en]) {
    for (const code of Object.keys(L.signals)) {
      const t = L.signals[code](Object.assign({}, SAMPLE, { real: code === "MKT_LIQ_INFLATED" ? 2 : SAMPLE.real }));
      assert.ok(t && !/undefined|NaN|\$\{/.test(t), code + ": " + t);
    }
    for (const code of Object.keys(L.errors)) {
      const t = L.errors[code](SAMPLE);
      assert.ok(t && !/undefined|NaN/.test(t), code + ": " + t);
    }
  }
});

test("labels exist for every level, type, light and progress step", () => {
  const steps = new Set();
  for (const f of ["wallet.js", "holders.js", "changes.js", "confluence.js"]) for (const m of src(f).matchAll(/progress\([^,]+, "([a-zA-Z]+)"/g)) steps.add(m[1]);
  assert.ok(steps.size >= 10);
  for (const lang of ["es", "en"]) {
    LEVELS.forEach((l) => assert.notEqual(levelLabel(l, lang), l));
    TYPES.forEach((t) => assert.ok(typeInfo(t, lang).label && typeInfo(t, lang).note));
    LIGHTS.forEach((k) => assert.notEqual(lightLabel(k, lang), k));
    steps.forEach((st) => assert.notEqual(describeStep({ step: st }, lang), st, lang + " step " + st));
  }
});

test("every error code documented in errors.js has a message", () => {
  const codes = [...src("errors.js").matchAll(/^\/\/ {3}([A-Z_]+)\s/gm)].map((m) => m[1]);
  assert.ok(codes.length >= 12);
  for (const code of codes) for (const lang of ["es", "en"]) {
    const t = describeError({ code: code, data: { n: 1, total: 2, status: 500 } }, lang);
    assert.ok(!/^(Algo ha fallado|Something failed)/.test(t), lang + " " + code + ": " + t);
  }
});

test("describe never fails on unknown codes or missing data", () => {
  assert.equal(describe({ code: "NOPE" }, "es"), "NOPE");
  assert.equal(describe({ code: "CON_OK", data: { w1: 1 } }, "es"), "Sin concentración preocupante (mayor wallet individual: 1%)");
  assert.equal(describe({ code: "MINT_ACTIVE" }, "en"), "The creator can still mint more tokens (mint authority active)");
});

test("rugcheckSummary asks again when RugCheck reads a locked pool as 0%, keeps a real low value", async () => {
  const seq = (vals) => { let n = 0; return { calls: () => n, fetch: async () => ok({ lpLockedPct: vals[Math.min(n++, vals.length - 1)] }) }; };
  let f = seq([0, 99.9]);
  assert.equal((await rugcheckSummary(createClient({ fetch: f.fetch }), "m")).lpLockedPct, 99.9);
  assert.equal(f.calls(), 2);
  f = seq([0, 0, 0]);
  assert.equal((await rugcheckSummary(createClient({ fetch: f.fetch }), "m")).lpLockedPct, 0);
  assert.equal(f.calls(), 3);
  f = seq([98]);
  assert.equal((await rugcheckSummary(createClient({ fetch: f.fetch }), "m")).lpLockedPct, 98);
  assert.equal(f.calls(), 1);
});
