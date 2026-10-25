// api.mainnet-beta.solana.com answers 403 to anything coming from a browser. PublicNode serves almost
// everything (accounts, signatures, transactions) quickly, but blocks token-by-owner and largest-holder
// queries. Those go to Solana Vibe Station, which accepts them without a key but only at ~1 per second,
// so they go through a queue (see client.js). With your own RPC URL everything goes to that URL.
export const PUBLIC_RPC = "https://solana-rpc.publicnode.com";
export const VIBE_RPC = "https://public.rpc.solanavibestation.com";
export const DEX = "https://api.dexscreener.com/tokens/v1/solana/";
export const RUGCHECK = "https://api.rugcheck.xyz/v1/tokens/";
export const GECKO = "https://api.geckoterminal.com/api/v2/networks/solana/";
export const HELIUS_API = "https://api.helius.xyz/v0/addresses/";
export const COINGECKO_SOL = "https://api.coingecko.com/api/v3/coins/solana/market_chart?vs_currency=usd&days=365";

export const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const TOKEN_2022 = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const SYSTEM_PROGRAM = "11111111111111111111111111111111";
export const PUMP_PROGRAM = "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P";
// dexId of a token still on Pump.fun's bonding curve: DexScreener says "pumpfun", GeckoTerminal "pump-fun"
export const PUMP_CURVE_DEXES = ["pumpfun", "pump-fun"];

export const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const USDT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
export const WSOL = "So11111111111111111111111111111111111111112";

export const KNOWN = {
  [WSOL]: "SOL (wrapped)",
  [USDC]: "USDC",
  [USDT]: "USDT"
};

// Symbols that scams usually copy, with their official address (checked on DexScreener)
export const FAMOUS = {
  USDC, USDT, SOL: WSOL, WSOL,
  JUP: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", BONK: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
  WIF: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", PYTH: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3",
  JTO: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", RAY: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R",
  PYUSD: "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo", MSOL: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So",
  JITOSOL: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", TRUMP: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN",
  PUMP: "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn", JLP: "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4",
  POPCAT: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", HNT: "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux",
  RENDER: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof", ORCA: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE",
  DRIFT: "DriFtupJYLTosbwoN8koMbEYSx54aFAVLddWsbksjwg7",
  // Bitcoin and Ether only exist on Solana bridged: a Pump.fun token called "BTC" is never the real one
  BTC: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh", WBTC: "3NZ9JMVBmGAqocybic2c7LQCJScmgsAZ6vQqTDzcqmJh",
  ETH: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs", WETH: "7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs"
};

// Token-2022 extensions that add risk, with the points they add to the no-market spam score
export const EXT_POINTS = {
  permanentDelegate: 25,
  transferHook: 15,
  transferFeeConfig: 10,
  nonTransferable: 10,
  defaultAccountState: 10
};

// Risk levels, from worst to best (also the default sort order of results)
export const LEVELS = ["HIGH", "MEDIUM", "LOW", "SPAM", "NO_DATA", "NO_MARKET"];
export const TYPES = ["STABLE", "TOKENIZED", "BRIDGED", "CREATOR", "OPEN"];
export const LIGHTS = ["control", "concentration", "market", "dependency"];
export const RANKS = { ok: 0, na: 0, warn: 1, bad: 2 };

export const ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
