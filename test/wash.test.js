import { test } from "node:test";
import assert from "node:assert/strict";
import { washStats, washSignal } from "../src/index.js";

// n operaciones de `wallets` wallets; cada una compra y vende lo mismo si `vuelta`
function ops(n, wallets, vuelta, grande) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const w = "W" + (i % wallets);
    const buy = vuelta ? Math.floor(i / wallets) % 2 === 0 : i % 7 !== 0;
    out.push({ tx_from_address: w, kind: buy ? "buy" : "sell", volume_in_usd: String(grande && i % wallets === 0 ? 5000 : 100), block_timestamp: new Date(1e12 + i * 60000).toISOString() });
  }
  return out;
}

test("volumen normal: muchas wallets que sobre todo compran, sin señal", () => {
  const st = washStats(ops(300, 150, false));
  assert.ok(st.rt < 50 && st.wallets === 150);
  assert.equal(washSignal(st), null);
});

test("bots que compran y venden lo mismo: aviso", () => {
  const st = washStats(ops(300, 150, true));
  assert.ok(st.rt >= 80);
  const s = washSignal(st);
  assert.equal(s.code, "MKT_FAKE_VOLUME");
  assert.equal(s.s, "warn");
});

test("pocas wallets que lo mueven casi todo en ida y vuelta: rojo", () => {
  const s = washSignal(washStats(ops(300, 6, true, true)));
  assert.equal(s.s, "bad");
  assert.equal(s.data.few, true);
});

test("con pocas operaciones no se juzga", () => {
  assert.equal(washSignal(washStats(ops(60, 4, true))), null);
  assert.equal(washStats([]), null);
});
