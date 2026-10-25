import { PUBLIC_RPC, VIBE_RPC } from "./constants.js";
import { ScanError, cancelled, isCancel } from "./errors.js";
import { sleep } from "./util.js";

// Methods PublicNode rejects with 403; if another one shows up it gets added at runtime
const PN_BLOCKED_DEFAULT = ["getTokenLargestAccounts", "getTokenAccountsByOwner", "getTokenSupply"];

/**
 * Creates the network client every engine function uses.
 *
 * @param {object}   [opts]
 * @param {string}   [opts.rpcUrl]        your own RPC URL (Helius, Triton...). Without it the free
 *                                        PublicNode + Solana Vibe Station combination is used.
 * @param {string}   [opts.heliusApiKey]  Helius key for PnL. If omitted it is taken from rpcUrl when
 *                                        that URL is a Helius one (the key is never sent anywhere else).
 * @param {AbortSignal} [opts.signal]     aborts every pending request with a CANCELLED ScanError
 * @param {Function} [opts.fetch]         fetch implementation (defaults to globalThis.fetch)
 * @param {number}   [opts.retryDelayMs]  first retry delay, doubled each time (default 1200)
 * @param {number}   [opts.vibeIntervalMs] spacing of the free Vibe Station queue (default 1100)
 */
export function createClient(opts) {
  opts = opts || {};
  const fetchImpl = opts.fetch || globalThis.fetch;
  if (!fetchImpl) throw new Error("no fetch available: pass opts.fetch or use Node 18+");
  const rpcUrl = (opts.rpcUrl || "").trim() || PUBLIC_RPC;
  const publicRpc = opts.publicRpc || PUBLIC_RPC;
  const vibeRpc = opts.vibeRpc || VIBE_RPC;
  const signal = opts.signal || null;
  const retryDelay = opts.retryDelayMs === undefined ? 1200 : opts.retryDelayMs;
  const vibeInterval = opts.vibeIntervalMs === undefined ? 1100 : opts.vibeIntervalMs;
  const blocked = {};
  PN_BLOCKED_DEFAULT.forEach(function (m) { blocked[m] = 1; });
  let vibeNext = 0;

  function checkAbort() {
    if (signal && signal.aborted) throw cancelled();
  }
  function ownRpc() {
    return rpcUrl !== publicRpc;
  }
  function heliusKey() {
    if (opts.heliusApiKey) return opts.heliusApiKey;
    // Only use the key if the configured RPC really is Helius: otherwise it is never sent to api.helius.xyz
    try {
      const u = new URL(rpcUrl);
      if (!/(^|\.)helius-rpc\.com$|(^|\.)helius\.xyz$/i.test(u.hostname)) return null;
      return u.searchParams.get("api-key") || null;
    } catch (e) { return null; }
  }

  async function rawFetch(url, init) {
    checkAbort();
    try {
      return await fetchImpl(url, signal ? Object.assign({}, init, { signal: signal }) : init);
    } catch (e) {
      if (signal && signal.aborted) throw cancelled();
      throw e;
    }
  }

  // JSON fetch with retries on 429, 5xx and network errors (doubling the wait each time)
  async function jfetch(url, init, tries) {
    let wait = retryDelay, last = null;
    tries = tries || 4;
    for (let i = 0; i < tries; i++) {
      checkAbort();
      try {
        const r = await rawFetch(url, init);
        if (r.status === 429 || r.status >= 500) {
          last = new ScanError("HTTP", "HTTP " + r.status, { status: r.status });
          await sleep(wait); wait *= 2; continue;
        }
        if (!r.ok) throw new ScanError("HTTP", "HTTP " + r.status, { status: r.status });
        return await r.json();
      } catch (e) {
        if (isCancel(e) || (e.code === "HTTP" && e.data.status >= 400 && e.data.status < 500)) throw e;
        last = e; await sleep(wait); wait *= 2;
      }
    }
    if (last && last.code) throw last;
    throw new ScanError("NETWORK", (last && last.message) || "no response", { cause: last && last.message });
  }

  // Fetch that never throws (except on cancel): used for optional extras such as RugCheck,
  // which must never block the main result if they fail, time out or are down
  async function softJson(url, timeoutMs) {
    checkAbort();
    const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    let onAbort = null;
    if (ctrl && signal) { onAbort = function () { ctrl.abort(); }; signal.addEventListener("abort", onAbort); }
    const to = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs || 8000) : null;
    try {
      const r = await fetchImpl(url, ctrl ? { signal: ctrl.signal } : undefined);
      if (!r.ok) return null;
      return await r.json();
    } catch (e) {
      return null;
    } finally {
      if (to) clearTimeout(to);
      if (onAbort) signal.removeEventListener("abort", onAbort);
      checkAbort();
    }
  }

  async function rpcAt(url, method, params, tries) {
    const j = await jfetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: method, params: params })
    }, tries);
    if (j.error) throw new ScanError("RPC", j.error.message || "RPC error", { rpcCode: j.error.code });
    return j.result;
  }

  async function vibeSlot() {
    const now = Date.now(), at = Math.max(now, vibeNext);
    vibeNext = at + vibeInterval;
    if (at > now) await sleep(at - now);
    checkAbort();
  }

  async function rpc(method, params) {
    if (ownRpc()) return rpcAt(rpcUrl, method, params);
    // PublicNode accepts at most 10 accounts per getMultipleAccounts: split and merge the result
    if (method === "getMultipleAccounts" && params[0].length > 10) {
      const parts = [];
      for (let i = 0; i < params[0].length; i += 10) parts.push(rpc(method, [params[0].slice(i, i + 10)].concat(params.slice(1))));
      const rs = await Promise.all(parts);
      return { context: rs[0].context, value: [].concat.apply([], rs.map(function (r) { return r.value; })) };
    }
    if (!blocked[method]) {
      try { return await rpcAt(publicRpc, method, params); }
      catch (e) {
        if (isCancel(e) || !(e.code === "HTTP" && (e.data.status === 401 || e.data.status === 403))) throw e;
        blocked[method] = 1;
      }
    }
    await vibeSlot();
    return rpcAt(vibeRpc, method, params, 6);   // more retries: its limit sometimes trips even when the queue is respected
  }

  return { rpc: rpc, jfetch: jfetch, softJson: softJson, ownRpc: ownRpc, heliusKey: heliusKey, checkAbort: checkAbort, rpcUrl: rpcUrl, retryDelayMs: opts.retryDelayMs };
}
