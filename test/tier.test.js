import test from "node:test";
import assert from "node:assert/strict";
import { tierFrom, BIG_PROJECTS, tierLabel, tierNote } from "../src/index.js";

const NOW = Date.UTC(2026, 10, 14, 12), DAY = 86400000;
const L = (items) => [{ k: "control", s: "ok", items: [{ code: "CTL_OK", s: "ok" }] }, { k: "market", s: items.length ? "warn" : "ok", items: items.length ? items : [{ code: "MKT_OK", s: "ok" }] }];
const pair = (days, mc, liq) => ({ pairCreatedAt: NOW - days * DAY, marketCap: mc || 1e6, liquidity: { usd: liq || 100e3 } });
const JUP = "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN";
const t = (lights, p, mint, o) => tierFrom(lights, p, mint || "Some1", Object.assign({ now: NOW }, o)).tier;

test("one serious warning is red; two mild ones orange; one mild one yellow", () => {
  assert.equal(t(L([{ code: "MKT_LIQ_VERY_LOW", s: "bad" }]), pair(30)), "RED");
  assert.equal(t(L([{ code: "MKT_LIQ_LOW", s: "warn" }, { code: "MKT_VOLUME_LOW", s: "warn" }]), pair(30)), "ORANGE");
  assert.equal(t(L([{ code: "MKT_LIQ_LOW", s: "warn" }]), pair(30)), "YELLOW");
  // forced red (impostor, exact copy, fake liquidity) even with clean lights
  assert.equal(t(L([]), pair(30), null, { red: true }), "RED");
  // something not checked: yellow at best
  assert.equal(t([{ k: "concentration", s: "na", items: [{ code: "CON_UNAVAILABLE", s: "na" }] }], pair(30)), "YELLOW");
});

test("newborn tokens: yellow is the cap, not the start; 'new' itself is not a warning", () => {
  const r = tierFrom(L([{ code: "MKT_NEW", s: "warn" }]), pair(2), "Some1", { now: NOW });
  assert.deepEqual(r, { tier: "YELLOW", cap: true, capUntil: NOW + 5 * DAY, big: null });
  // a newborn with one mild warning is yellow (not orange because of "new")
  assert.equal(t(L([{ code: "MKT_NEW", s: "warn" }, { code: "MKT_LIQ_LOW", s: "warn" }]), pair(1)), "YELLOW");
  // and it can still be red
  assert.equal(t(L([{ code: "MKT_NEW", s: "warn" }, { code: "MKT_LIQ_VERY_LOW", s: "bad" }]), pair(0)), "RED");
  // unknown age: capped too
  assert.equal(tierFrom(L([]), { marketCap: 1e6 }, "Some1", { now: NOW }).cap, true);
  // from day 7 it can be green
  assert.equal(t(L([]), pair(7)), "GREEN");
});

test("diamond: being on the hand-reviewed list (a big project or a trusted issuer) is enough", () => {
  assert.ok(BIG_PROJECTS[JUP]);
  assert.equal(t(L([]), pair(1000), JUP), "DIAMOND");
  // whatever its numbers, its age or what is normal for it (its own treasury, a governance mint)
  assert.equal(t([{ k: "concentration", s: "bad", items: [{ code: "CON_HIGH", s: "bad" }] }], pair(1), "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R"), "DIAMOND");
  assert.equal(t(L([]), { liquidity: { usd: 2.3e6 } }, "EPjF", { trusted: "Circle" }), "DIAMOND");
  assert.equal(tierFrom(L([]), pair(1000), JUP, { now: NOW }).big, "Jupiter");
  // the same numbers without being on the list: green at most (a memecoin is never diamond)
  assert.equal(t(L([]), pair(1000, 850e6, 470e3), "Meme1"), "GREEN");
});

test("tier names and notes in Spanish and English", () => {
  assert.equal(tierLabel("DIAMOND", "es"), "Diamante");
  assert.equal(tierLabel({ tier: "ORANGE" }, "en"), "Orange");
  assert.equal(tierLabel(null, "es"), "");
  assert.equal(tierNote({ tier: "RED" }, "es"), "Mejor ni tocarlo");
  assert.match(tierNote({ tier: "YELLOW", tierCap: true }, "en"), /under 7 days/);
});
