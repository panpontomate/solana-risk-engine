// Five tiers (0.6.0, 14/11/2026): what a token IS, from most to least trustworthy, alongside the old risk level
// (lvl: HIGH/MEDIUM/LOW), which stays as it was so the registry's history is not broken.
//   DIAMOND  on SolFlag's hand-reviewed list: big projects (BIG_PROJECTS) and trusted issuers (Circle, Paxos...).
//            Being on the list is enough: the work is in reviewing who gets in (decided with the user, 14/11)
//   GREEN    no warning at all and 7 days or more on the market
//   YELLOW   one mild warning, or something that could not be checked, or younger than 7 days (the CAP: a newborn
//            token has proven nothing yet, so YELLOW is the best it can get unless a big project is behind it)
//   ORANGE   danger without a trap: one serious warning that is not a trap (very low liquidity, a few wallets
//            holding most of it: hard to sell, but nobody is deceiving you), or two or more mild warnings
//   RED      a trap (someone can take your money or you are being deceived: TRAPS below), or two serious warnings
// Both fail almost always at launch (registry: 99.4 % red and 99.6 % orange dead in a day): the difference is the
// KIND of danger, not how long it lasts (decided with the user, 14/11: "there are things worse than others").
// Warnings are counted one by one (two mild ones in the same light are two). "New" (MKT_NEW) is not counted as a
// warning: age is handled by the cap. In the registry, one red flag on a new token already meant 99.5 % dead in a
// day, the same as three (tools/estudio/madurez.md in escaner-solana).

export const TIERS = ["DIAMOND", "GREEN", "YELLOW", "ORANGE", "RED"];
export const NEW_CAP_DAYS = 7;
// Serious warnings that are a trap: the creator can print more, pull the liquidity or is launching in series (or his
// earlier tokens died), the liquidity or volume is fake, or it pretends to be another token
export const TRAPS = ["CTL_MINT_ACTIVE", "MKT_LP_UNLOCKED", "MKT_LIQ_INFLATED", "MKT_FAKE_VOLUME", "IMPOSTOR", "BRAND_COPY",
  "COPYCAT", "CTL_SERIAL_CREATOR", "CTL_SERIAL_PAYER", "CTL_CREATOR_HISTORY"];
const DAY = 86400000;

// Big projects with a public product and team, reviewed by hand (address checked on DexScreener on 14/11/2026).
// A memecoin is never here however big it is: it can be GREEN, not DIAMOND.
export const BIG_PROJECTS = {
  So11111111111111111111111111111111111111112: "Solana (wrapped SOL)",
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: "Jupiter",
  jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL: "Jito",
  J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn: "Jito (JitoSOL)",
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: "Marinade (mSOL)",
  HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3: "Pyth Network",
  "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R": "Raydium",
  orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE: "Orca",
  "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ": "Wormhole",
  hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux: "Helium",
  rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof: "Render"
};

function ageDays(pair, now) {
  return pair && pair.pairCreatedAt ? (now - pair.pairCreatedAt) / DAY : null;
}

/**
 * Tier of a token with a market.
 * @param lights      the four lights (buildLights + front signals), as in assess()
 * @param pair        its main pair (DexScreener shape)
 * @param mint        its address
 * @param [o.trusted] name of the trusted issuer behind it, if any (Circle, Paxos...; not after an unreviewed key change)
 * @param [o.red]     forced red (impostor, exact brand copy, fake liquidity), as assess() forces HIGH
 * @param [o.now]     time (ms)
 * @returns {tier, cap, capUntil, big}  cap: it would be GREEN but is younger than 7 days; capUntil: when the cap ends;
 *          big: the project or issuer on the list (then the lights are still shown, but the tier is DIAMOND)
 */
export function tierFrom(lights, pair, mint, o) {
  o = o || {};
  const now = o.now || Date.now();
  const big = BIG_PROJECTS[mint] || o.trusted || null;
  const out = { tier: null, cap: false, capUntil: null, big: big };
  if (big) { out.tier = "DIAMOND"; return out; }
  const items = [];
  (lights || []).forEach(function (l) { (l.items || []).forEach(function (x) { if (x.code !== "MKT_NEW") items.push(x); }); });
  const badItems = items.filter(function (x) { return x.s === "bad"; }), bad = badItems.length;
  const trap = badItems.some(function (x) { return TRAPS.indexOf(x.code) >= 0; });
  const warn = items.filter(function (x) { return x.s === "warn"; }).length;
  const na = items.some(function (x) { return x.s === "na"; });
  if (o.red || trap || bad >= 2) { out.tier = "RED"; return out; }
  if (bad === 1 || warn >= 2) { out.tier = "ORANGE"; return out; }
  if (warn === 1 || na) { out.tier = "YELLOW"; return out; }
  const age = ageDays(pair, now);
  // a newborn token has proven nothing yet: YELLOW at best (a big project or trusted issuer is DIAMOND above)
  if (age === null || age < NEW_CAP_DAYS) {
    out.tier = "YELLOW"; out.cap = true;
    if (pair && pair.pairCreatedAt) out.capUntil = pair.pairCreatedAt + NEW_CAP_DAYS * DAY;
    return out;
  }
  out.tier = "GREEN";
  return out;
}
