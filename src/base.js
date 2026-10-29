import { WALLET_BASE_URL } from "./constants.js";

// SolFlag's wallet base: what its collector learns from every launch it checks (exchanges, launch farms,
// distributors, serial creators), refreshed every 30 minutes. A known exchange is recognised at once,
// without asking the RPC how many transactions it makes

export const WALLET_TYPES = ["exchange", "granja", "repartidor", "creador en serie", "sniper"];
const BASE_TTL = 600000;
const caches = new WeakMap();

// The base, or null when it cannot be read (it is an extra: nothing depends on it). Each client keeps it
// 10 minutes per URL
export async function loadWalletBase(client, url) {
  url = url || WALLET_BASE_URL;
  if (!caches.has(client)) caches.set(client, {});
  const cache = caches.get(client), c = cache[url];
  if (c && Date.now() - c.at < BASE_TTL) return c.data;
  const j = await client.softJson(url, 8000);
  const data = j && j.wallets && typeof j.wallets === "object" ? j : null;
  cache[url] = { at: Date.now(), data: data };
  return data;
}

// Type of a wallet in the base ("exchange", "granja"...) or null
export function knownType(base, addr) {
  const w = base && base.wallets && base.wallets[addr];
  return (w && WALLET_TYPES.indexOf(w.t) >= 0) ? w.t : null;
}
