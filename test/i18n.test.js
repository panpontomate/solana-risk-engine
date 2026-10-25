import test from "node:test";
import assert from "node:assert/strict";
import { describe, explainLight, levelLabel, missingText, typeInfo, describeStep, describeError, addLanguage, ScanError, buildLights, FAMOUS } from "../src/index.js";

test("Spanish texts match the original scanner", () => {
  assert.equal(describe({ code: "CTL_MINT_ACTIVE" }, "es"), "El creador puede crear más tokens (mint activo)");
  assert.equal(describe({ code: "MKT_LIQ_VERY_LOW", data: { liq: 3000 } }, "es"), "Liquidez muy baja (3.000 $)");
  assert.equal(describe({ code: "MKT_NEW", data: { days: 0 } }, "es"), "Mercado muy nuevo (menos de un día)");
  assert.equal(describe({ code: "MKT_NEW", data: { days: 1 } }, "es"), "Mercado muy nuevo (1 día)");
  assert.equal(describe({ code: "CON_HIGH", data: { w1: 40.2, w10: 80, prog: 25 } }, "es"),
    "La mayor wallet individual tiene el 40% y las 10 mayores el 80% del supply. Los pools y programas guardan el 25%");
  assert.equal(describe({ code: "CON_OK", data: { w1: 3, prog: 5 } }, "es"), "Sin concentración preocupante (mayor wallet individual: 3%)");
  assert.equal(describe({ code: "IMPOSTOR", data: { symbol: "BONK", real: FAMOUS.BONK } }, "es"),
    "Se hace pasar por BONK: el BONK de verdad tiene otra dirección (DezX…B263). Es una copia, casi seguro una estafa");
  assert.equal(describe({ code: "MKT_LIQ_LOW", data: { liq: 20000, offSolana: true } }, "es"),
    "Liquidez baja (20.000 $) y su mercado principal puede estar fuera de Solana");
});

test("English and fallback", () => {
  assert.equal(describe({ code: "MKT_LIQ_VERY_LOW", data: { liq: 3000 } }, "en"), "Very low liquidity ($3,000)");
  assert.equal(describe({ code: "MKT_LIQ_VERY_LOW", data: { liq: 3000 } }, "xx"), "Very low liquidity ($3,000)");
  assert.equal(describe({ code: "SOMETHING_NEW" }, "en"), "SOMETHING_NEW");
});

test("explainLight joins a light's signals", () => {
  const info = { mintAuth: "X", freezeAuth: "X", ext: [], authKind: {} };
  const p = { liquidity: { usd: 1e6 }, volume: { h24: 1e6 } };
  const l = buildLights(info, { skip: true }, p, 0, "CREATOR", null)[0];
  assert.equal(explainLight(l, "es"), "El creador puede crear más tokens (mint activo). El creador puede congelar cuentas (freeze activo)");
});

test("levels, types, steps and missing data", () => {
  assert.equal(levelLabel("HIGH", "es"), "Riesgo alto");
  const r = { lvl: "MEDIUM", lights: [{ k: "control", s: "ok" }, { k: "concentration", s: "na" }] };
  assert.equal(levelLabel(r, "es"), "Medio por falta de datos");
  assert.equal(missingText(r, "es"), "la concentración de holders");
  assert.equal(typeInfo("CREATOR", "en").label, "Creator-controlled");
  assert.equal(describeStep({ step: "tokens", done: 3, total: 10 }, "es"), "Revisando tokens… 3/10");
});

test("errors get friendly messages", () => {
  assert.match(describeError(new ScanError("NETWORK", "x"), "es"), /servicios gratuitos/);
  assert.match(describeError(new ScanError("HTTP", "x", { status: 500 }), "es", { ownRpc: true }), /tu URL de RPC/);
  assert.equal(describeError(new ScanError("IS_NFT"), "en"), "That address is an NFT, not a token. The scanner does not review NFTs.");
  assert.match(describeError(new Error("boom"), "en"), /boom/);
});

test("addLanguage plugs in a new language", () => {
  addLanguage("test", { signals: { CTL_NONE: () => "ok!" } });
  assert.equal(describe({ code: "CTL_NONE" }, "test"), "ok!");
});
