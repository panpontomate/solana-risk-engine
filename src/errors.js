// Every error the engine throws on purpose is a ScanError with a stable `code`, so callers can
// show their own message (see i18n describeError) instead of parsing English text.
//
// Codes:
//   CANCELLED          the AbortSignal passed to the client fired
//   HTTP               a service answered with an HTTP error (data.status)
//   NETWORK            no answer after all retries
//   RPC                the RPC answered with a JSON-RPC error
//   DEX_UNREACHABLE    DexScreener could not be reached at all
//   HELIUS_REQUIRED    PnL needs a Helius API key
//   SOL_PRICE          no SOL price available to value trades
//   INVALID_ADDRESS    not a Solana address
//   NOT_A_TOKEN        the address is not a token mint
//   IS_NFT             the mint is an NFT (decimals 0, supply 1)
//   NO_HOLDERS         the RPC returned no holder data
//   TOO_FEW_WALLETS    fewer readable wallets than needed (data.n, data.total)
//   TOO_FEW_TOKENS     fewer valid mints than needed
export class ScanError extends Error {
  constructor(code, message, data) {
    super(message || code);
    this.name = "ScanError";
    this.code = code;
    if (data) this.data = data;
  }
}

export function isCancel(e) {
  return !!e && e.code === "CANCELLED";
}

export function cancelled() {
  return new ScanError("CANCELLED", "cancelled");
}
