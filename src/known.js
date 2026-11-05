// Wallets with a public name. Each address was checked by hand against its public label on Solscan
// (5 Nov 2026) before being added: a wrong entry would hide a real whale, so only add what you can verify.
// Exchanges keep their users' funds in these hot wallets, so a big balance there is not one person
// who can dump: concentration names them and leaves them out of the count.
export const KNOWN_WALLETS = {
  "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S": { n: "Binance", t: "exchange" },
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9": { n: "Binance", t: "exchange" },
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM": { n: "Binance", t: "exchange" },
  "3yFwqXBfZY4jBVUafQ1YEXw189y2dN3V5KQq9uzBDy1E": { n: "Binance", t: "exchange" },
  "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS": { n: "Coinbase", t: "exchange" },
  "2AQdpHJ2JpcEgPiATUXjQxA8QmafFegfQwSLWSprPicm": { n: "Coinbase", t: "exchange" },
  "GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE": { n: "Coinbase", t: "exchange" },
  "5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhYrPSqtJNmcD": { n: "OKX", t: "exchange" },
  "9un5wqE3q4oCjyrDkwsdD48KteCJitQX5978Vh7KKxHo": { n: "OKX", t: "exchange" },
  "AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2": { n: "Bybit", t: "exchange" },
  "FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5": { n: "Kraken", t: "exchange" },
  "u6PJ8DtQuPFnfmwHbGFULQ4u4EgjDiyYKjVEsynXq2w": { n: "Gate", t: "exchange" },
  "BmFdpraQhkiDQE6SnfG5omcA1VwzqfXrwtNYBwWTymy6": { n: "KuCoin", t: "exchange" },
  "ASTyfSima4LLAdDgoFGkgqoKowG1LZFDr9fAQrg7iaJZ": { n: "MEXC", t: "exchange" },
  "A77HErqtfN1hLLpvZ9pCtu66FEtM8BveoaKbbMoZ4RiR": { n: "Bitget", t: "exchange" },
  "88xTWZMeKfiTgbfEmPLdsUCQcZinwUfk25EBQZ21XMAZ": { n: "HTX", t: "exchange" },
  "6FEVkH17P9y8Q9aCkDdPcMDjvj7SVxrTETaYEm8f51Jy": { n: "Crypto.com", t: "exchange" },
  // off the curve, so it already counts as a program; named so it can be shown
  "1nc1nerator11111111111111111111111111111111": { n: "Incinerator", t: "burn" }
};

// {n, t} for a named wallet, or null
export function knownWallet(addr) {
  return Object.prototype.hasOwnProperty.call(KNOWN_WALLETS, addr) ? KNOWN_WALLETS[addr] : null;
}
