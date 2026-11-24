// Points by section (perfil.js): one real token per section, with the numbers of the approved mockups (21/11/2026)
import test from "node:test";
import assert from "node:assert/strict";
import { scoreProfile, sectionOf, bornInLaunchpad } from "../src/perfil.js";

const NOW = Date.UTC(2026, 10, 21);
const DAY = 86400000;
// a minimal assess() result: codes with their state, concentration, the main pair
function res(mint, { codes = [], w1 = null, w10 = null, liq = 0, vol = 0, dias = 400, dexId = "raydium", tierBig = null, creator = null, impostor = null } = {}) {
  const items = codes.map((c) => (typeof c === "string" ? { code: c, s: c.endsWith("!") ? "bad" : "ok" } : c)).map((x) => ({ ...x, code: x.code.replace("!", "") }));
  if (w1 != null) items.push({ code: "CON_OK", s: "ok", data: { w1, w10 } });
  return { mint, tierBig, creator, impostor, lights: [{ k: "x", items }], pair: { liquidity: { usd: liq }, volume: { h24: vol }, pairCreatedAt: NOW - dias * DAY, dexId } };
}
const pts = (r, p) => scoreProfile(r, p, { now: NOW });

test("meme: WIF, verde 80 (tope de una meme)", () => {
  const r = pts(res("EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", { codes: ["CTL_NONE"], w1: 17.6, w10: 36, liq: 93432, vol: 89117, dias: 900 }), null);
  assert.equal(r.ap, "meme"); assert.equal(r.pts, 80); assert.equal(r.tier, "GREEN");
});

test("meme: $ANSEM (24/11): una wallet de persona con el 49,2 % no pasa de naranja", () => {
  const r = pts(res("9cRCn9rGT8V2imeM2BaKs13yhMEais3ruM3rPvTGpump", { codes: ["CTL_NONE"], w1: 49.2, w10: 57.7, liq: 754228, vol: 11632665, dias: 161 }), null);
  assert.equal(r.checks.find((x) => x.k === "wallet").p, -34);
  assert.equal(r.tier, "ORANGE");
  const alto = pts(res("Alto11111111111111111111111111111111111pump", { codes: ["CTL_NONE"], w1: 41, w10: 20, liq: 3e6, vol: 9e6, dias: 900 }), null);
  assert.ok(alto.pts >= 50); assert.equal(alto.tier, "ORANGE"); assert.equal(alto.capWallet, true);
  const pocoMenos = pts(res("Menos1111111111111111111111111111111111pump", { codes: ["CTL_NONE"], w1: 39, w10: 20, liq: 3e6, vol: 9e6, dias: 900 }), null);
  assert.equal(pocoMenos.capWallet, false);
});

test("meme: menos de 7 días no pasa de amarillo; una trampa es rojo; muerto es rojo", () => {
  const nuevo = pts(res("Nuevo1111111111111111111111111111111111pump", { codes: ["CTL_NONE"], w1: 3, w10: 15, liq: 300000, vol: 900000, dias: 3 }), null);
  assert.equal(nuevo.tier, "YELLOW"); assert.equal(nuevo.cap, true); assert.ok(nuevo.pts >= 75);
  const copia = pts(res("Copia1111111111111111111111111111111111pump", { codes: ["CTL_NONE", "COPYCAT!"], w1: 3, w10: 15, liq: 300000, vol: 900000, dias: 30 }), null);
  assert.equal(copia.tier, "RED"); assert.equal(copia.trap, true);
  const muerto = pts(res("Muerto111111111111111111111111111111111pump", { codes: ["CTL_NONE"], w1: 3, w10: 15, liq: 500, vol: 20000, dias: 30 }), null);
  assert.equal(muerto.tier, "RED"); assert.equal(muerto.dead, true);
});

test("activo tokenizado: NVDA de Backpack, diamante 95", () => {
  const r = pts(res("NVDAVuiB7hwd3m5Wa1JuHNovPaPG6BH1QNztbKFxNjv", { codes: ["DEP_TRUSTED_ISSUER", { code: "DEP_PERMANENT_DELEGATE", s: "warn" }], liq: 444000, dias: 57 }),
    { ap: "rwa", desv: -0.0023, res: "parcial" });
  assert.equal(r.pts, 95); assert.equal(r.tier, "DIAMOND");
});

test("DeFi: JUP, diamante 95 (lista revisada)", () => {
  const r = pts(res("JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", { codes: ["CTL_NONE"], w1: 4, w10: 20, liq: 404000, dias: 1000, tierBig: "Jupiter" }),
    { ap: "defi", f30: 21.1e6, c: -0.04, r30: 6.6e6, tvl: 1938e6, desde: NOW / 1000 - 3 * 365 * 86400 });
  assert.equal(r.pts, 95); assert.equal(r.tier, "DIAMOND");
  assert.equal(r.checks.find((x) => x.k === "auditorias").col, "falta");
});

test("DeFi: un hackeo de más de 100 M$ sin devolver en el último año resta 40", () => {
  const r = pts(res("DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7", { codes: ["CTL_NONE"], w1: 4, w10: 20, liq: 90000, dias: 900 }),
    { ap: "defi", f30: 1.0e6, c: -0.2, r30: 25000, tvl: 193e6, hk: [{ d: NOW / 1000 - 230 * 86400, p: 295e6 }] });
  assert.equal(r.checks.find((x) => x.k === "hackeo").p, -40);
});

test("juego: CARDS, verde 100", () => {
  const r = pts(res("CARDSccUMFKoPRZxt5vt3ksUbxEFEcnZ3H2pd3dKxYjp", { codes: ["CTL_NONE"], w1: 0.7, w10: 5, liq: 3.2e6, dias: 440 }),
    { ap: "juegos", f30: 10e6, trad: 2218, org: 87, tit: 62962, titC: 0, dl: { lib: 2.0, bloq: 17.6 } });
  assert.equal(r.pts, 100); assert.equal(r.tier, "GREEN");
});

test("IA: NOS verde 100; Swarms (nacido en Pump.fun) amarillo 71 con reglas de meme + código (wallet del 33,8 %: -19 desde el 24/11)", () => {
  const nos = pts(res("nosXBVoaCTtYdLvKY6Csb4AC8JCdQKKAaWYtx2ZMoo7", { codes: ["CTL_NONE"], w1: 3.1, w10: 18, liq: 169000, dias: 372 }),
    { ap: "ia", cod: { dias: 1 }, trad: 524, org: 75, tit: 50029, dl: { lib: 0, bloq: 0 } });
  assert.equal(nos.pts, 100); assert.equal(nos.tier, "GREEN");
  const sw = pts(res("74SBV4zDXxTRgv1pEMoECskKBkZHc2yGPnc7GYVepump", { codes: ["CTL_NONE"], w1: 33.8, w10: 44.5, liq: 951880, vol: 89494, dias: 701 }),
    { ap: "ia", cod: { dias: 0 } });
  assert.equal(sw.lanz, true); assert.equal(sw.pts, 71); assert.equal(sw.tier, "YELLOW");
  const sinCodigo = pts(res("Perle1111111111111111111111111111111111111", { codes: ["CTL_NONE"], w1: 30.8, w10: 92, liq: 10081, dias: 240 }), { ap: "ia", trad: 18, org: 0, tit: 1960 });
  assert.equal(sinCodigo.checks.find((x) => x.k === "codigo").col, "falta");
  assert.equal(sinCodigo.pts, 25); assert.equal(sinCodigo.tier, "ORANGE");
});

test("apps: PUMP es una sola empresa en la lista revisada (no lanzadera aunque cotice en PumpSwap): diamante", () => {
  const r = pts(res("pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn", { codes: [{ code: "CTL_TRANSFER_HOOK", s: "warn" }], w1: 2.4, w10: 10.2, liq: 17e6, dias: 495, dexId: "pumpswap" }),
    { ap: "apps", f30: 118.3e6, r30: 42.8e6, h30: 18.8e6, trad: 25572, org: 97, tit: 445337, dl: { lib: 0.61, bloq: 5.4 } });
  assert.equal(bornInLaunchpad({ mint: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn", pair: { dexId: "pumpswap" } }), false);
  assert.equal(r.pts, 120); assert.equal(r.tier, "DIAMOND");
});

test("otros: Streamflow verde 85 (los desbloqueos restan 15)", () => {
  const r = pts(res("STREAMribRwybYpMmSYoCsQUdr6MZNXEqHgm7p1gu9M", { codes: ["CTL_NONE"], w1: 5.2, w10: 5.2, liq: 38374, dias: 426 }),
    { ap: "otros", f30: 176982, r30: 176982, h30: 11519, trad: 105, org: 53, tit: 22852, dl: { lib: 2.99, bloq: 33.7 } });
  assert.equal(r.pts, 85); assert.equal(r.tier, "GREEN");
  assert.equal(r.checks.find((x) => x.k === "desbloqueos").p, -15);
});

test("sin perfil: emisor conocido = activo tokenizado; lo demás, reglas de meme", () => {
  assert.equal(sectionOf(res("X", { codes: ["DEP_TRUSTED_ISSUER"] }), null), "rwa");
  assert.equal(sectionOf(res("Y", { codes: ["CTL_NONE"] }), null), "meme");
  assert.equal(sectionOf(res("Y"), { ap: "defi" }), "defi");
});
