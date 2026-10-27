import { EXT_POINTS, RANKS, PUMP_CURVE_DEXES } from "./constants.js";
import { isCancel } from "./errors.js";
import { short, sleep } from "./util.js";
import { getMint, getAuthKinds, getConc } from "./tokens.js";
import { impostorOf } from "./markets.js";
import { rugcheckSummary, creatorLaunches } from "./rugcheck.js";

// Every finding is a "signal": {code, s, data}. `s` is ok | na | warn | bad, `data` holds the numbers
// behind it. Turning signals into sentences is i18n's job (describe / explainLight), never the engine's.
function sig(code, s, data) {
  const o = { code: code, s: s };
  if (data) o.data = data;
  return o;
}

const DAY = 86400000;
// Other tokens launched by the same creator in the last 24 h that make it a serial launcher
export const SERIAL_WARN = 2, SERIAL_BAD = 5;
// Creator track record: at least HISTORY_MIN older tokens and this share of them never took off
export const HISTORY_MIN = 3, HISTORY_WARN = 0.8, HISTORY_BAD_MIN = 10, HISTORY_BAD = 0.9;

/* ---------- old point score: only for tokens without a market, to spot spam ---------- */
export function score(info) {
  let pts = 0;
  const why = [];
  if (!info) return { pts: 30, why: [sig("NO_INFO", "warn")] };
  const ak = info.authKind || {};
  if (info.mintAuth) {
    if (ak[info.mintAuth] === "program") { pts += 10; why.push(sig("MINT_BY_PROGRAM", "warn")); }
    else { pts += 25; why.push(sig("MINT_ACTIVE", "bad", { byWallet: ak[info.mintAuth] === "wallet" })); }
  }
  if (info.freezeAuth) {
    if (ak[info.freezeAuth] === "program") { pts += 8; why.push(sig("FREEZE_BY_PROGRAM", "warn")); }
    else { pts += 20; why.push(sig("FREEZE_ACTIVE", "warn", { byWallet: ak[info.freezeAuth] === "wallet" })); }
  }
  info.ext.forEach(function (e) { if (EXT_POINTS[e]) { pts += EXT_POINTS[e]; why.push(sig("EXTENSION", "warn", { ext: e })); } });
  why.push(sig("NO_MARKET", "na"));
  return { pts: pts, why: why };
}

/* ---------- token type ---------- */
export function tokenType(info, pair, now) {
  if (!info) return null;
  now = now || Date.now();
  const ak = info.authKind || {};
  const sym = ((pair && pair.baseToken && pair.baseToken.symbol) || "") + " " + ((pair && pair.baseToken && pair.baseToken.name) || "");
  const price = Number((pair && pair.priceUsd) || 0);
  const liq = (pair && pair.liquidity && pair.liquidity.usd) || 0;
  const ageDays = (pair && pair.pairCreatedAt) ? (now - pair.pairCreatedAt) / DAY : 0;
  // Being called "USD something" is not enough to be judged more leniently than a normal token:
  // it needs a stable price, real liquidity and some time trading (otherwise a scammer only has to
  // name the token "USDX" and keep the price near $1 for a while)
  if (/USD|DOLLAR/i.test(sym) && price > 0.97 && price < 1.03 && liq >= 200000 && ageDays >= 30) return "STABLE";
  if (info.ext.indexOf("permanentDelegate") >= 0) return "TOKENIZED";
  const walletAuth = (info.mintAuth && ak[info.mintAuth] !== "program") || (info.freezeAuth && ak[info.freezeAuth] !== "program");
  if (walletAuth) return "CREATOR";
  if (info.mintAuth || info.freezeAuth) return "BRIDGED";
  return "OPEN";
}

/* ---------- the four traffic lights ---------- */
function mkLight(k, items, okSignal) {
  if (!items.length) return { k: k, s: "ok", items: [okSignal] };
  let st = "ok";
  items.forEach(function (x) { if (RANKS[x.s] > RANKS[st]) st = x.s; });
  // na ranks like ok for "worst of", but an unchecked light must stay na so levelFrom can cap it
  if (st === "ok" && items.some(function (x) { return x.s === "na"; })) st = "na";
  return { k: k, s: st, items: items };
}

/**
 * @param info   mint info from getMint (+ authKind) or null if it could not be read
 * @param conc   concentration from getConc, {skip:true}, or null if the RPC did not answer
 * @param pair   best DexScreener pair (required: lights are only built for tokens with a market)
 * @param value  USD value the analysed wallet holds (0 when checking a token alone)
 * @param type   tokenType(info, pair)
 * @param rc     RugCheck summary or null
 * @param launches  creatorLaunches result or null: what else the creator launched (last 24 h, and how older ones did)
 * @returns      [control, concentration, market, dependency]
 */
export function buildLights(info, conc, pair, value, type, rc, now, launches) {
  now = now || Date.now();
  const ak = (info && info.authKind) || {};
  let it;

  // 1) creator control
  it = [];
  if (!info) it.push(sig("NO_INFO", "warn"));
  else {
    if (info.mintAuth && ak[info.mintAuth] !== "program") it.push(sig("CTL_MINT_ACTIVE", "bad"));
    if (info.freezeAuth && ak[info.freezeAuth] !== "program") it.push(sig("CTL_FREEZE_ACTIVE", "warn"));
    if (info.ext.indexOf("transferHook") >= 0) it.push(sig("CTL_TRANSFER_HOOK", "warn"));
    if (info.ext.indexOf("transferFeeConfig") >= 0) it.push(sig("CTL_TRANSFER_FEE", "warn"));
    if (info.ext.indexOf("nonTransferable") >= 0) it.push(sig("CTL_NON_TRANSFERABLE", "warn"));
    if (info.ext.indexOf("defaultAccountState") >= 0) it.push(sig("CTL_DEFAULT_FROZEN", "warn"));
  }
  // Launch farms put out a token every few minutes and drop each one as soon as buyers arrive: in a
  // 100-token Pump.fun sample one wallet launched 7 copies of "GMS" in 10 minutes
  if (launches && launches.day >= SERIAL_WARN) it.push(sig("CTL_SERIAL_CREATOR", launches.day >= SERIAL_BAD ? "bad" : "warn", { n: launches.day, creator: launches.creator }));
  // Older launches that went nowhere: farms that spread their tokens over days escape the 24 h count
  if (launches && launches.old >= HISTORY_MIN && launches.dead / launches.old >= HISTORY_WARN) {
    const bad = launches.old >= HISTORY_BAD_MIN && launches.dead / launches.old >= HISTORY_BAD;
    it.push(sig("CTL_CREATOR_HISTORY", bad ? "bad" : "warn", { old: launches.old, dead: launches.dead, best: launches.best, creator: launches.creator }));
  }
  const control = mkLight("control", it, sig((info && (info.mintAuth || info.freezeAuth)) ? "CTL_ONLY_PROGRAMS" : "CTL_NONE", "ok"));

  // 2) concentration in people (pools and programs do not count)
  let concentration;
  const soft = (type === "STABLE" || type === "TOKENIZED" || type === "BRIDGED");
  if (conc && conc.skip) concentration = mkLight("concentration", [sig("CON_SKIPPED", "na")]);
  else if (!conc) concentration = mkLight("concentration", [sig("CON_UNAVAILABLE", "na")]);
  else if (conc.ok) {
    let st = "ok";
    if (conc.w1 > 30 || conc.w10 > 70) st = "bad"; else if (conc.w1 > 15 || conc.w10 > 50) st = "warn";
    if (soft && st === "bad") st = "warn";
    const data = { w1: conc.w1, w10: conc.w10, prog: conc.prog, wallets: conc.nW };   // prog >= 20 is worth mentioning
    const code = !conc.nW ? "CON_ALL_POOLS" : (st === "ok" ? "CON_OK" : "CON_HIGH");
    concentration = mkLight("concentration", [sig(code, st, data)]);
  } else {
    concentration = mkLight("concentration", [sig("CON_UNSPLIT", (conc.top1 > 30 || conc.top10 > 70) ? "warn" : "ok", { top1: conc.top1, top10: conc.top10 })]);
  }

  // 3) market and exit
  const liq = (pair.liquidity && pair.liquidity.usd) || 0, vol = (pair.volume && pair.volume.h24) || 0;
  it = [];
  if (pair.liqRaw) it.push(sig("MKT_LIQ_INFLATED", "bad", { reported: pair.liqRaw, real: liq }));
  else if (liq < 10000) it.push(sig("MKT_LIQ_VERY_LOW", "bad", { liq: liq }));
  else if (liq < 50000) it.push(sig("MKT_LIQ_LOW", "warn", { liq: liq }));
  if (vol < 1000) it.push(sig("MKT_VOLUME_LOW", "warn", { vol: vol }));
  if (pair.pairCreatedAt) {
    const d = (now - pair.pairCreatedAt) / DAY;
    if (d < 7) it.push(sig("MKT_NEW", "warn", { days: Math.floor(d) }));
  }
  if (value > 0 && liq > 0 && value / liq >= 0.1) it.push(sig("MKT_POSITION_HEAVY", "warn", { pct: value / liq * 100 }));
  // Dollars in the pool do not say who can take them out: if the LP tokens are neither locked nor
  // burned, the creator can pull the liquidity at any time whatever the rest says. Only for markets
  // under 90 days: that is when the creator alone provides liquidity and rug pulls are typical. In
  // veteran tokens (JUP, WIF...) many market makers provide it and unlocked LP is not a signal: applying
  // it there gave false positives (JUP scored worse than a new memecoin)
  const young = !pair.pairCreatedAt || (now - pair.pairCreatedAt) / DAY < 90;
  // On Pump.fun's bonding curve there is no LP at all: the curve program holds the liquidity and nobody
  // can pull it (RugCheck reports 0% locked, which flagged 49 of 75 curve tokens in a 100-token sample)
  const onCurve = PUMP_CURVE_DEXES.indexOf(pair.dexId) >= 0;
  if (rc && !soft && young && !onCurve && liq > 0 && typeof rc.lpLockedPct === "number" && isFinite(rc.lpLockedPct)) {
    if (rc.lpLockedPct < 20) it.push(sig("MKT_LP_UNLOCKED", "bad", { pct: rc.lpLockedPct }));
    else if (rc.lpLockedPct < 60) it.push(sig("MKT_LP_PARTLY_LOCKED", "warn", { pct: rc.lpLockedPct }));
  }
  if (type === "BRIDGED" && liq < 50000 && it.length) it[0] = Object.assign({}, it[0], { data: Object.assign({}, it[0].data, { offSolana: true }) });
  const market = mkLight("market", it, sig("MKT_OK", "ok", { liq: liq, vol: vol }));

  // 4) dependency on an issuer or a bridge
  it = [];
  if (info) {
    if ((info.mintAuth && ak[info.mintAuth] === "program") || (info.freezeAuth && ak[info.freezeAuth] === "program"))
      it.push(sig("DEP_PROGRAM_AUTHORITY", "warn"));
    if (info.ext.indexOf("permanentDelegate") >= 0) it.push(sig("DEP_PERMANENT_DELEGATE", "warn"));
  }
  if (type === "STABLE") it.push(sig("DEP_STABLE_ISSUER", "warn"));
  const dependency = mkLight("dependency", it, sig("DEP_NONE", "ok"));

  return [control, concentration, market, dependency];
}

export function levelFrom(lights) {
  let b = 0, w = 0, na = 0;
  lights.forEach(function (l) { if (l.s === "bad") b++; else if (l.s === "warn") w++; else if (l.s === "na") na++; });
  let lvl = (b >= 2 || (b === 1 && w >= 1)) ? "HIGH" : ((b === 1 || w >= 2) ? "MEDIUM" : "LOW");
  // What could not be checked does not count as "fine": with a check missing, at best it is medium risk
  if (lvl === "LOW" && na > 0) lvl = "MEDIUM";
  // A market under 7 days old has no track record: it is never "low risk", even with nothing else wrong.
  // Other single warnings stay low: on established tokens they are normal for their type (a staking pool's
  // program-controlled mint, a transfer hook...); measured on 62 real tokens, this rule moved 9 brand-new
  // tokens from low to medium and no established one
  if (lvl === "LOW" && lights.some(function (l) { return (l.items || []).some(function (x) { return x.code === "MKT_NEW"; }); })) lvl = "MEDIUM";
  return { lvl: lvl, sev: 3 * b + w + (na && !b && !w ? 1 : 0) };
}

// "Medium" with no concrete signal at all: only because some check could not run (e.g. holders without
// your own RPC). Callers should say so explicitly so the scanner does not look like it marks everything the same
export function dataOnly(r) {
  return r.lvl === "MEDIUM" && !!r.lights && !r.lights.some(function (l) { return l.s === "bad" || l.s === "warn"; }) && r.lights.some(function (l) { return l.s === "na"; });
}

// The signals worth showing as "why": everything not ok, in light order
export function reasonsFrom(lights) {
  const out = [];
  lights.forEach(function (l) { if (l.s !== "ok") l.items.forEach(function (x) { if (x.s !== "ok") out.push(Object.assign({ k: l.k }, x)); }); });
  return out;
}

/**
 * Full risk assessment of one token.
 *
 * @param client
 * @param mint
 * @param pair       best DexScreener pair or null (no market)
 * @param [opts.value]           USD the analysed wallet holds of it (for the "heavy position" check)
 * @param [opts.marketUnknown]   the DexScreener batch for this mint failed: no data, not "no market"
 * @param [opts.skipConcentration]
 * @param [opts.skipCreator]     do not ask RugCheck what else the creator launched (markets under 7 days only)
 * @returns null for NFTs, otherwise {mint, sym, name, lvl, sev, pts, type, lights, reasons, impostor, value, pair, img}
 */
export async function assess(client, mint, pair, opts) {
  opts = opts || {};
  const value = opts.value || 0;
  if (opts.marketUnknown) {
    return {
      mint: mint, sym: short(mint), name: "", pts: 0, sev: 0, lvl: "NO_DATA",
      reasons: [sig("MARKET_UNCHECKED", "na")], lights: null, type: null, impostor: null, value: value, pair: null, img: null
    };
  }
  const rcPromise = pair ? rugcheckSummary(client, mint) : Promise.resolve(null);   // in parallel with the RPC calls below
  // Serial launching only matters while a token is new; RugCheck's full report is small (~10 KB) then
  const fresh = pair && !opts.skipCreator && (!pair.pairCreatedAt || Date.now() - pair.pairCreatedAt < 7 * DAY);
  const launchPromise = fresh ? creatorLaunches(client, mint) : Promise.resolve(null);
  let info = null, conc = null;
  try { info = await getMint(client, mint); } catch (e) { if (isCancel(e)) throw e; }
  if (info && info.decimals === 0 && info.supply === 1) return null;   // NFT
  // Without a market concentration is not checked: saves half the requests
  if (info && pair && (info.mintAuth || info.freezeAuth)) {
    try { info.authKind = await getAuthKinds(client, info); } catch (e) { if (isCancel(e)) throw e; }
  }
  if (info && pair && opts.skipConcentration) conc = { skip: true };
  else if (info && pair) {
    // In tokens with millions of holders (BONK) getTokenLargestAccounts sometimes times out: a second try usually works
    for (let tryC = 0; tryC < 2 && !conc; tryC++) {
      try { conc = await getConc(client, mint, info.supply); }
      catch (e) { if (isCancel(e)) throw e; conc = null; if (!tryC) await sleep(client.retryDelayMs === undefined ? 1500 : client.retryDelayMs); }
    }
  }
  const rc = await rcPromise, launches = await launchPromise;
  const base = (pair && pair.baseToken) || {};
  let lvl, sev = 0, reasons = [], lights = null, type = null, pts = 0, imp = null;
  if (pair) {
    type = tokenType(info, pair);
    lights = buildLights(info, conc, pair, value, type, rc, null, launches);
    imp = impostorOf(mint, pair);
    if (imp) {
      const prev = lights[0];
      lights[0] = { k: "control", s: "bad", items: [sig("IMPOSTOR", "bad", { symbol: imp.sym, real: imp.real })].concat(prev.s !== "ok" ? prev.items : []) };
    }
    const lf = levelFrom(lights); lvl = lf.lvl; sev = lf.sev; reasons = reasonsFrom(lights);
    if (imp) { lvl = "HIGH"; sev += 5; }   // a copy is high risk even if everything else looks normal
  } else {
    const s = score(info);
    pts = s.pts; reasons = s.why; lvl = pts >= 25 ? "SPAM" : "NO_MARKET";
  }
  return {
    mint: mint, sym: base.symbol || short(mint), name: base.name || "", pts: pts, sev: sev,
    lvl: lvl, type: type, lights: lights, reasons: reasons, impostor: imp, value: value, pair: pair,
    rugcheck: rc ? { lpLockedPct: rc.lpLockedPct, score: rc.score_normalised !== undefined ? rc.score_normalised : rc.score } : null,
    creator: launches,
    img: (pair && pair.info && pair.info.imageUrl) || null
  };
}
