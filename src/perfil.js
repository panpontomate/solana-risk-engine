// Points by section (perfil), 21/11/2026 — agreed with the user section by section on real tokens (mockups in
// maquetas/web/escaner-*.html). Pure function: no network. It takes what assess() already found on chain (lights,
// pair, creator) plus the daily profile of the token (perfiles.json, built by the Ecosystem job: fees, revenue,
// what goes back to the token, activity, code, unlocks, hacks...) and returns its section, points (base 50, bar
// up to 110), the colour of each check and the tier. The old risk level (lvl) and tierFrom() are left untouched.
//
// Sections: meme · rwa (tokenized assets) · defi · juegos (games) · ia (AI) · apps (apps and bots) · otros (other).
// Fixed rules for all of them: a trap is RED; DIAMOND only for the hand-reviewed list (BIG_PROJECTS, trusted
// issuers) and then with 90 points or more, and the list is GREEN at least; a token born in a launchpad (Pump.fun…)
// is scored as a meme (plus code for AI and business for apps/other) and GREEN is its best; under 7 days, YELLOW;
// in a meme, one person's wallet with 40 % or more of the supply: ORANGE at best (capWallet).
// What we do not have yet ("falta") never adds or subtracts.

import { BIG_PROJECTS, TRAPS, NEW_CAP_DAYS } from "./tier.js";

// one person's wallet with this % of the supply or more caps a meme at ORANGE (case $ANSEM, 24/11/2026: 49,2 %)
export const WALLET_CAP = 40;

export const PERFILES = ["meme", "rwa", "defi", "juegos", "ia", "apps", "otros"];
// Big projects added with the points by section (21/11): Pump.fun — one company (launchpad, PumpSwap, Terminal,
// mobile app, perps) that buys back its token with part of what it earns
export const BIG_EXTRA = { pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn: "Pump.fun" };
// In a project (not a meme) minting is a minus, not a trap: games and networks mint rewards on purpose
const TRAPS_PROY = ["MKT_LP_UNLOCKED", "MKT_FAKE_VOLUME", "IMPOSTOR", "BRAND_COPY", "COPYCAT", "MKT_LIQ_INFLATED"];
const DAY = 86400000, YEAR = 365 * DAY;

function itemsOf(res) {
  const it = [];
  (res.lights || []).forEach(function (l) { (l.items || []).forEach(function (x) { it.push(x); }); });
  return it;
}
// launchpad: the address of Pump.fun / Bonk tokens ends in pump / bonk, or it is still on the launchpad's curve.
// Not PumpSwap: other tokens trade there too (PUMP itself). A token on the reviewed list is never "launchpad".
export function bornInLaunchpad(res) {
  const p = res.pair || {};
  if (BIG_PROJECTS[res.mint] || BIG_EXTRA[res.mint]) return false;
  return /(pump|bonk)$/i.test(res.mint || "") || /^(pumpfun|launchlab)$/i.test(p.dexId || "");
}
function reviewed(res, it) {
  return !!(res.tierBig || BIG_PROJECTS[res.mint] || BIG_EXTRA[res.mint]) ||
    it.some(function (x) { return x.code === "DEP_TRUSTED_ISSUER" || x.code === "CTL_KNOWN_ISSUER"; });
}

/** Section of a token: the profile's (daily file) or, without one, from what is on chain. */
export function sectionOf(res, perfil) {
  if (perfil && PERFILES.indexOf(perfil.ap) >= 0) return perfil.ap;
  const it = itemsOf(res);
  if (it.some(function (x) { return x.code === "DEP_TRUSTED_ISSUER" || x.code === "CTL_KNOWN_ISSUER" || x.code === "DEP_KNOWN_ISSUER" || x.code === "DEP_STABLE_ISSUER"; })) return "rwa";
  return "meme";   // no data: only what is on chain, which is what the meme rules use
}

/**
 * Points by section.
 * @param res     assess() result for a token with a market (lights, pair, mint, tierBig, creator)
 * @param perfil  its entry in perfiles.json, or null. Fields (all optional): ap, f30 (fees 30 d, $), c (fees change
 *                vs the 30 days before, 0.1 = +10 %), r30 (revenue), h30 (what goes back to the token: buybacks, burns
 *                or sharing), tvl, aud (audits), hk [{d: unix s, p: $ lost and not returned}], desde (listed, unix s),
 *                trad (traders 24 h), org (organic score 0-100), tit (holders), titC (holders change 24 h, 0.01 = 1 %),
 *                cod {dias} (days since the last change in its public code; null = no code linked), dl {lib, bloq}
 *                (% of supply unlocked in 30 days and still locked; null = no Streamflow contracts),
 *                desv (price vs the real asset, 0.01 = 1 %), res (reserves: "si" | "parcial"), uso (true: used a lot)
 * @param [o.now] time (ms)
 * @returns {ap, pts, tier, cap, capWallet, floor, trap, checks:[{k, col, p, d}]}  col: suma | resta | grave | neutro | falta
 */
export function scoreProfile(res, perfil, o) {
  o = o || {};
  const now = o.now || Date.now();
  const P = perfil || {};
  const it = itemsOf(res);
  const has = function (c) { return it.some(function (x) { return x.code === c; }); };
  const pair = res.pair || {};
  const liq = (pair.liquidity && pair.liquidity.usd) || 0, vol = (pair.volume && pair.volume.h24) || 0;
  const dias = pair.pairCreatedAt ? (now - pair.pairCreatedAt) / DAY : null;
  const conc = it.filter(function (x) { return x.data && x.data.w1 != null; })[0];
  const w1 = conc ? conc.data.w1 : null, w10 = conc ? conc.data.w10 : null;
  const ap = sectionOf(res, perfil), lanz = bornInLaunchpad(res), rev = reviewed(res, it);
  const forced = !!(res.impostor || has("IMPOSTOR") || has("BRAND_COPY"));
  let n = 50; const checks = [];
  const add = function (k, p, d, col) {
    n += p;
    checks.push({ k: k, p: p, d: d === undefined ? null : d, col: col || (p > 0 ? "suma" : p <= -20 ? "grave" : p < 0 ? "resta" : "neutro") });
  };
  const falta = function (k) { checks.push({ k: k, p: 0, d: null, col: "falta" }); };
  let trap = false, dead = false, memeRules = ap === "meme" || (lanz && ap !== "rwa" && ap !== "defi");

  if (ap === "rwa") {
    // tokenized assets: who is behind matters more than liquidity (the issuer can bring liquidity from elsewhere)
    if (forced) { trap = true; add("copia", 0, null, "grave"); }
    add("oficial", rev ? 25 : -10);
    if (has("CTL_ISSUER_KEYS_CHANGED")) add("claves", -30); else if (rev) add("claves", 5);
    if (P.desv == null) falta("precio");
    else if (Math.abs(P.desv) > 0.2) add("precio", 0, P.desv, "falta");   // over 20 % is a data error to review
    else add("precio", Math.abs(P.desv) < 0.005 ? 10 : Math.abs(P.desv) <= 0.02 ? 0 : -15, P.desv);
    if (P.res === "si") add("reservas", 10); else if (P.res === "parcial") add("reservas", 5); else falta("reservas");
    add("liquidez", liq >= 1e5 ? 5 : liq >= 2e4 ? 0 : -5, liq);
    if (has("DEP_PERMANENT_DELEGATE")) add("mover", -5);
    if (has("CTL_TRANSFER_FEE")) add("comision", rev ? -15 : -5);
    if (P.uso) add("uso", 5);
  } else if (memeRules) {
    trap = forced || it.some(function (x) { return x.s === "bad" && TRAPS.indexOf(x.code) >= 0; });
    if (has("CTL_FREEZE_ACTIVE")) add("control", -25);
    else if (has("CTL_TRANSFER_FEE") || has("CTL_TRANSFER_HOOK")) add("control", -10);
    else if (has("CTL_NONE") || has("CTL_ONLY_PROGRAMS")) add("control", 15);
    // gradual, no steps: 49 % and 51 % must not score far apart (case $ANSEM, 24/11: 49,2 % only took -15)
    if (w10 != null) add("reparto", w10 < 25 ? 10 : w10 > 40 ? -Math.min(20, Math.max(10, Math.round((w10 - 40) * 2 / 3))) : 0, w10);
    if (w1 != null && w1 > 15) add("wallet", -Math.min(40, Math.max(5, Math.round(w1 - 15))), w1);
    add("liquidez", liq >= 1e5 ? 10 : liq >= 5e4 ? 5 : liq >= 2e4 ? -5 : liq >= 1e4 ? -10 : liq >= 1e3 ? -25 : -40, liq);
    if (liq < 1e3) dead = true;
    if (has("MKT_LP_PARTLY_LOCKED")) add("lp", -10);
    add("volumen", vol >= 1e4 ? 5 : vol < 1e3 ? -5 : 0, vol);
    if (dias != null) add("edad", dias >= 365 ? 10 : dias >= 30 ? 5 : dias >= 7 ? 0 : dias >= 1 ? -5 : -10, dias);
    const cr = res.creator;
    if (cr && cr.old > 0 && !cr.dead) add("creador", 5);
    if (ap === "ia") codigo();
    if (ap === "apps" || ap === "otros") negocio();
  } else {
    // a project (defi, games, AI, apps, other): what it earns and whether it is used matter, not only the market
    trap = forced || it.some(function (x) { return x.s === "bad" && TRAPS_PROY.indexOf(x.code) >= 0; });
    add("oficial", 15);
    if (P.f30 == null) falta("comisiones");
    else {
      add("comisiones", P.f30 >= 1e6 ? 10 : P.f30 >= 1e5 ? 5 : P.f30 < 1e4 ? -5 : 0, P.f30);
      if (P.c != null) add("tendencia", P.c > 0.1 ? 5 : P.c < -0.3 ? -5 : 0, P.c);
    }
    if (P.r30 != null && P.r30 >= 1e4) add("ingresos", 5, P.r30);
    if (ap === "defi") {
      if (P.tvl) add("depositos", P.tvl >= 1e8 ? 5 : P.tvl < 1e6 ? -5 : 0, P.tvl);
      if (P.aud) add("auditorias", 10, P.aud); else falta("auditorias");
    }
    if (ap === "apps" || ap === "otros") negocio();
    if (ap === "ia") codigo();
    if (ap !== "defi") {
      if (P.trad != null) add("traders", P.trad >= 1000 ? 10 : P.trad >= 100 ? 5 : P.trad < 20 ? -10 : 0, P.trad);
      if (P.org != null) add("organico", P.org >= 50 ? 5 : P.org < 15 ? -10 : 0, P.org);
      if (P.tit != null) add("titulares", P.tit >= 1e5 ? 10 : P.tit >= 1e4 ? 5 : P.tit < 1000 ? -5 : 0, P.tit);
      if (ap === "juegos" && P.titC != null) add("titularesC", P.titC > 0.01 ? 5 : P.titC < -0.02 ? -5 : 0, P.titC);
    }
    if (has("CTL_MINT_ACTIVE")) add("crear", -10);
    if (has("CTL_FREEZE_ACTIVE")) add("congelar", -10);
    if (P.dl === undefined || P.dl === null) falta("desbloqueos");
    else add("desbloqueos", P.dl.lib > 2 ? -15 : P.dl.lib > 0.5 ? -5 : 0, P.dl);
    if (w1 != null && w1 > 30) add("wallet", w1 > 50 ? -15 : -5, w1);
    add("liquidez", liq >= 1e5 ? 5 : liq < 2e4 ? -15 : 0, liq);
    if (ap === "defi") { if (P.desde && now / 1000 - P.desde > 2 * 365 * 86400) add("edad", 5); }
    else if (dias != null && dias > 365) add("edad", 5);
    hackeos();
  }

  function codigo() {   // AI: is there public code and is it moving? No code linked does not subtract
    if (!P.cod || P.cod.dias == null) falta("codigo");
    else add("codigo", P.cod.dias <= 30 ? 10 : P.cod.dias <= 90 ? 5 : P.cod.dias > 180 ? -5 : 0, P.cod.dias);
  }
  function negocio() {  // apps and other: does the token earn from the business (buybacks, burns, sharing)?
    if (P.h30 != null && P.h30 >= 1e4) add("negocio", P.h30 >= 1e5 ? 10 : 5, P.h30);
    else checks.push({ k: "negocio", p: 0, d: P.h30 == null ? null : P.h30, col: P.h30 == null ? "falta" : "neutro" });
  }
  function hackeos() {
    const hk = P.hk || [], year = now / 1000 - 365 * 86400;
    const rec = hk.filter(function (h) { return h.d > year; }), lost = rec.reduce(function (a, h) { return a + (h.p || 0); }, 0);
    if (ap === "defi") {
      if (rec.length) add("hackeo", lost >= 1e8 ? -40 : lost >= 1e7 ? -25 : lost > 0 ? -15 : -5, lost);
      else if (hk.length) add("hackeo", -5, 0);
    } else if (rec.length) add("hackeo", -15, lost);
  }

  // tier
  const listed = !!(res.tierBig || BIG_PROJECTS[res.mint] || BIG_EXTRA[res.mint]);
  let tier = (trap || dead) ? "RED" : n >= 75 ? "GREEN" : n >= 50 ? "YELLOW" : n >= 25 ? "ORANGE" : "RED";
  let cap = false, floor = false;
  if (!trap && !dead) {
    if (ap === "rwa") {
      if (rev && !has("CTL_ISSUER_KEYS_CHANGED")) { if (n >= 90) tier = "DIAMOND"; else if (tier !== "GREEN") { tier = "GREEN"; floor = true; } }
      else if (tier === "GREEN") tier = "YELLOW";   // an unreviewed issuer is YELLOW at best
    } else if (listed && !memeRules) {
      if (n >= 90) tier = "DIAMOND"; else if (tier !== "GREEN") { tier = "GREEN"; floor = true; }
    }
    if (memeRules && dias != null && dias < NEW_CAP_DAYS && tier === "GREEN") { tier = "YELLOW"; cap = true; }
  }
  // one person's wallet (pools, programs and exchanges already left out of w1) can sink a meme on its own: ORANGE at best
  let capWallet = false;
  if (!trap && !dead && memeRules && w1 != null && w1 >= WALLET_CAP && (tier === "GREEN" || tier === "YELLOW")) { tier = "ORANGE"; capWallet = true; }
  return { ap: ap, lanz: lanz && memeRules && ap !== "meme", pts: n, tier: tier, cap: cap, capWallet: capWallet, floor: floor, trap: trap, dead: dead, checks: checks };
}
