import es from "./es.js";
import en from "./en.js";
import { dataOnly } from "../risk.js";

const LANGS = { es: es, en: en };

function pack(lang) {
  return LANGS[lang] || LANGS.en;
}

/** Adds or replaces a language: addLanguage("pt", {...same shape as en.js}) */
export function addLanguage(code, texts) {
  LANGS[code] = texts;
}

/** One signal ({code, data}) as a sentence */
export function describe(signal, lang) {
  const L = pack(lang), f = L.signals[signal.code];
  let t = f ? f(signal.data || {}) : signal.code;
  if (signal.data && signal.data.offSolana) t += L.offSolana;
  return t;
}

/** A whole traffic light as one sentence, its signals joined like the original scanner did */
export function explainLight(light, lang) {
  return light.items.map(function (x) { return describe(x, lang); }).join(". ");
}

export function lightLabel(k, lang) {
  return pack(lang).lights[k] || k;
}

/** Label of a result's level; says "medium due to missing data" when that is the only reason */
export function levelLabel(result, lang) {
  const L = pack(lang);
  if (typeof result === "string") return L.levels[result] || result;
  return dataOnly(result) ? L.levels.MEDIUM_DATA_ONLY : (L.levels[result.lvl] || result.lvl);
}

/** What could not be checked, e.g. "la concentración de holders y el mercado" */
export function missingText(result, lang) {
  const L = pack(lang), and = lang === "es" ? " y " : " and ";
  return (result.lights || []).filter(function (l) { return l.s === "na"; }).map(function (l) { return L.missing[l.k]; }).join(and);
}

export function typeInfo(type, lang) {
  return type ? pack(lang).types[type] || null : null;
}

/** Progress object from onProgress as text, e.g. "Revisando tokens… 3/10" */
export function describeStep(p, lang) {
  const L = pack(lang);
  let t = L.steps[p.step] || p.step;
  if (p.done !== undefined && p.total) t += " " + p.done + "/" + p.total;
  return t;
}

export function describeNote(code, lang) {
  return pack(lang).notes[code] || code;
}

/**
 * A friendly message for any error the engine throws.
 * @param [ctx.ownRpc]  whether the user configured their own RPC (changes the network advice)
 */
export function describeError(e, lang, ctx) {
  const L = pack(lang), code = e && e.code;
  if (code === "NETWORK" || code === "HTTP" || code === "RPC") return L.errors[ctx && ctx.ownRpc ? "NETWORK_OWN" : "NETWORK_PUBLIC"]();
  const f = L.errors[code];
  if (f) return f(e.data || {});
  return L.errors.UNKNOWN({ message: (e && e.message) || String(e) });
}

/** Formatting helpers of each language: format(lang).usd(1234) */
export function format(lang) {
  return pack(lang).fmt;
}
