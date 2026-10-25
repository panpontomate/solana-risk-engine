// Is a key a normal wallet (a point on the ed25519 curve) or a PDA (off the curve)?
// Used when an account does not exist on chain: an empty wallet is on the curve, a PDA is not.
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const P25519 = (1n << 255n) - 19n;

function fmod(a) { a %= P25519; return a < 0n ? a + P25519 : a; }
function fpow(b, e) { let r = 1n; b = fmod(b); while (e > 0n) { if (e & 1n) r = r * b % P25519; b = b * b % P25519; e >>= 1n; } return r; }
const D25519 = fmod(-121665n * fpow(121666n, P25519 - 2n));

// Decodes a base58 address into its 32 bytes, or null if it is not a valid 32-byte key
export function b58bytes(str) {
  let n = 0n, i;
  const out = [];
  for (i = 0; i < str.length; i++) { const k = B58.indexOf(str[i]); if (k < 0) return null; n = n * 58n + BigInt(k); }
  while (n > 0n) { out.unshift(Number(n & 255n)); n >>= 8n; }
  for (i = 0; i < str.length && str[i] === "1"; i++) out.unshift(0);
  return out.length === 32 ? out : null;
}

export function onCurve(bytes) {
  if (!bytes) return false;
  let y = 0n;
  for (let i = 31; i >= 0; i--) { let b = BigInt(bytes[i]); if (i === 31) b &= 127n; y = (y << 8n) | b; }
  if (y >= P25519) return false;
  const y2 = y * y % P25519, u = fmod(y2 - 1n), v = fmod(D25519 * y2 + 1n);
  if (v === 0n) return false;
  const x2 = u * fpow(v, P25519 - 2n) % P25519;
  if (x2 === 0n) return true;
  return fpow(x2, (P25519 - 1n) / 2n) === 1n;
}

export function isOnCurve(address) {
  return onCurve(b58bytes(address));
}
