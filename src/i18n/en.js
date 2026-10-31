function usd(n) {
  if (!n) return "$0";
  if (n < 0.01) return "<$0.01";
  return "$" + n.toLocaleString("en-US", { minimumFractionDigits: n < 1000 ? 2 : 0, maximumFractionDigits: n < 1000 ? 2 : 0 });
}
function pct(n) { return Math.round(n) + "%"; }
function short(a) { return a.slice(0, 4) + "…" + a.slice(-4); }
function prog(d) { return d && d.prog >= 20 ? ". Pools and programs hold " + pct(d.prog) : ""; }

const EXT = {
  permanentDelegate: "The issuer can move or burn your tokens (permanent delegate). Normal for tokenized stocks, but you have to trust the issuer",
  transferHook: "Has a transfer hook: runs external code on every transfer",
  transferFeeConfig: "Charges a fee on every transfer",
  nonTransferable: "Cannot be transferred",
  defaultAccountState: "New accounts can be created frozen"
};

export default {
  fmt: { usd: usd, pct: pct, short: short },
  signals: {
    NO_INFO: () => "Could not read the token's information",
    MINT_BY_PROGRAM: () => "A program controls the mint (usually a bridge or protocol): you have to trust that code",
    MINT_ACTIVE: (d) => "The creator can still mint more tokens (mint authority active" + (d && d.byWallet ? ", held by a wallet" : "") + ")",
    FREEZE_BY_PROGRAM: () => "A program controls freezing: it can freeze accounts according to its code",
    FREEZE_ACTIVE: (d) => "The creator can freeze accounts (freeze authority active" + (d && d.byWallet ? ", held by a wallet" : "") + ")",
    EXTENSION: (d) => EXT[d.ext] || ("Extension " + d.ext),
    NO_MARKET: () => "No market on DexScreener (no price or liquidity)",
    MARKET_UNCHECKED: () => "Could not check this token's market (network error reaching DexScreener): analyse it again to check",
    KNOWN_TOKEN: () => "Well-known token",

    CTL_MINT_ACTIVE: () => "The creator can mint more tokens (mint authority active)",
    CTL_FREEZE_ACTIVE: () => "The creator can freeze accounts (freeze authority active)",
    CTL_TRANSFER_HOOK: () => "Runs external code on every transfer",
    CTL_TRANSFER_FEE: () => "Charges a fee on every transfer",
    CTL_NON_TRANSFERABLE: () => "Cannot be transferred",
    CTL_DEFAULT_FROZEN: () => "New accounts can be created frozen",
    CTL_ONLY_PROGRAMS: () => "Only program-controlled authorities (see dependency)",
    CTL_KNOWN_ISSUER: (d) => "Controlled by its issuer, " + d.issuer + " (see dependency)",
    CTL_NONE: () => "No active authorities: nobody can mint more or freeze",
    CTL_SERIAL_CREATOR: (d) => "The creator launched " + d.n + " other tokens in the last 24 h (per RugCheck): a serial launcher, who usually drops each token as soon as buyers arrive",
    BRAND_COPY: (d) => "Uses the name of " + d.brand + ", a real company with no token on Solana: it is not official, almost certainly an imitation to draw buyers",
    BRAND_NAME: (d) => "Uses the name of " + d.brand + ", a real company: it is not an official " + d.brand + " token",
    COPYCAT: (d) => "There " + (d.n === 1 ? "is another token" : "are " + d.n + " more tokens") + " with the same name and ticker; the oldest one with a real market (" + short(d.original) + ", " + d.days + (d.days === 1 ? " day" : " days") + " old) is not this one: check you have the right address",
    HOLD_GROUP: (d) => d.n + " holders got their first SOL from the same wallet and together hold " + pct(d.pct) + " of the supply: most likely one person or team",
    CTL_CREATOR_HISTORY: (d) => "Of the " + d.old + " tokens the creator launched before (over 24 h ago), " + d.dead + " stayed under $10,000 market cap (per RugCheck): their launches rarely take off",
    IMPOSTOR: (d) => "Uses the name " + d.symbol + ", but it is not the original " + d.symbol + " (that one has another address: " + short(d.real) + "). Make sure it is the token you want",

    CON_SKIPPED: () => "Holder concentration not checked",
    CON_UNAVAILABLE: () => "Could not check holder concentration (the service did not answer; try again in a while)",
    CON_ALL_POOLS: (d) => "Almost all the supply is in pools or programs" + prog(d),
    CON_OK: (d) => "No worrying concentration (largest individual wallet: " + pct(d.w1) + ")" + prog(d),
    CON_HIGH: (d) => "The largest individual wallet holds " + pct(d.w1) + " and the top 10 hold " + pct(d.w10) + " of the supply" + prog(d),
    CON_UNSPLIT: (d) => "Could not separate pools from people. The largest account holds " + pct(d.top1) + " of the supply",

    MKT_LIQ_INFLATED: (d) => "Inflated liquidity: DexScreener says " + usd(d.reported) + ", but the pool only has about " + usd(d.real) + " in real tokens (USDC, USDT or SOL). That is the most you could get out when selling" + (d.reported >= 100 * Math.max(d.real, 1) ? ". A gap like that is no accident: it is set up to make the token look established" : ""),
    MKT_LIQ_VERY_LOW: (d) => "Very low liquidity (" + usd(d.liq) + ")",
    MKT_LIQ_LOW: (d) => "Low liquidity (" + usd(d.liq) + ")",
    MKT_VOLUME_LOW: (d) => "Almost no 24h volume (" + usd(d.vol) + ")",
    MKT_NEW: (d) => "Very new market (" + (d.days < 1 ? "less than a day" : d.days + (d.days === 1 ? " day" : " days")) + ")",
    MKT_POSITION_HEAVY: (d) => "This wallet's position equals " + pct(d.pct) + " of the liquidity: selling at once would move the price a lot",
    MKT_LP_UNLOCKED: (d) => "Only " + pct(d.pct) + " of the liquidity is locked or burned (per RugCheck): the rest can be pulled at once",
    MKT_LP_PARTLY_LOCKED: (d) => "Only " + pct(d.pct) + " of the liquidity is locked or burned (per RugCheck)",
    MKT_OK: (d) => "Liquidity " + usd(d.liq) + " · 24h volume " + usd(d.vol),

    DEP_PROGRAM_AUTHORITY: () => "A program controls the mint or freeze (bridge or protocol): you have to trust its code",
    DEP_PERMANENT_DELEGATE: () => "The issuer can move or burn your tokens (permanent delegate): you trust the issuer",
    DEP_STABLE_ISSUER: () => "Its value depends on whoever issues and backs it",
    DEP_KNOWN_ISSUER: (d) => "Issued by " + d.issuer + ": it can mint, freeze or move tokens, like any regulated issuer. You trust the issuer",
    DEP_NONE: () => "Does not depend on an issuer or a bridge"
  },
  offSolana: " and its main market may be outside Solana",
  levels: {
    HIGH: "High risk", MEDIUM: "Medium risk", LOW: "Low risk", SPAM: "Likely spam",
    NO_DATA: "Not checked", NO_MARKET: "No market", MEDIUM_DATA_ONLY: "Medium due to missing data"
  },
  types: {
    STABLE: { label: "Stablecoin", note: "Judged by its liquidity and trust in the issuer; concentration matters less." },
    TOKENIZED: { label: "Tokenized or regulated", note: "The issuer normally keeps control (permanent delegate). The real risk is trusting the issuer and having liquidity to exit." },
    BRIDGED: { label: "Bridged or protocol", note: "A program normally controls the mint. The real risk is trusting that bridge and its Solana market being small, since the main one may be on another chain." },
    CREATOR: { label: "Creator-controlled", note: "A wallet can mint more or freeze accounts: the typical scam pattern, so it is judged more strictly." },
    OPEN: { label: "Open token", note: "No creator authorities, typical of memecoins and new projects. Concentration in people and liquidity matter most." }
  },
  lights: { control: "Creator control", concentration: "Concentration", market: "Market and exit", dependency: "Dependency" },
  missing: { control: "who controls the token", concentration: "holder concentration", market: "the market", dependency: "issuer dependency" },
  steps: {
    address: "Checking the address…", wallet: "Reading the wallet…", markets: "Fetching prices and liquidity…",
    tokens: "Reviewing tokens…", token: "Reading the token…", owners: "Finding who owns each account…",
    kinds: "Telling wallets from pools and programs…", bots: "Separating people from bots and exchanges…",
    funders: "Looking for wallets funded from the same source…", exchangeSources: "Checking whether each group's source is an exchange…",
    creator: "Looking up who created the token (RugCheck)…", creatorTokens: "Reviewing the creator's other tokens…",
    networks: "Checking what wallet networks hold today…", wallets: "Reading wallets…",
    pnl: "Estimating each wallet's result…", done: "Done"
  },
  notes: {
    PNL_NO_HELIUS: "Wallet results were not estimated because there is no Helius key.",
    PNL_PARTIAL: "Some wallets' history could not be read.",
    PNL_APPROX: "SOL price history was unavailable: today's price was used and results may be far off."
  },
  errors: {
    CANCELLED: () => "Cancelled.",
    INVALID_ADDRESS: () => "That does not look like a Solana address. They are 32 to 44 letters and digits and do not start with 0x.",
    NOT_A_TOKEN: () => "That address is not a token.",
    IS_NFT: () => "That address is an NFT, not a token. The scanner does not review NFTs.",
    NO_HOLDERS: () => "The RPC returned no holder data.",
    HELIUS_REQUIRED: () => "Estimating results needs a Helius API key (or a Helius RPC URL with the key).",
    SOL_PRICE: () => "Could not get the SOL price to compute the result. Try again in a while.",
    DEX_UNREACHABLE: () => "Could not connect to DexScreener. Check your internet connection and try again.",
    TOO_FEW_WALLETS: (d) => d && d.filter ? "Only " + d.n + (d.n === 1 ? " wallet passes" : " wallets pass") + " the result filter (of " + d.total + " read)." : "At least 2 readable wallets are needed.",
    TOO_FEW_TOKENS: () => "Give at least 2 Solana token addresses.",
    NETWORK_PUBLIC: () => "The free Solana services did not answer (they get saturated sometimes). Wait a minute and try again, or use your own RPC URL (Helius has a free plan).",
    NETWORK_OWN: () => "Could not connect to your RPC URL. Check it was copied correctly (with the key at the end).",
    UNKNOWN: (d) => "Something failed: " + d.message + ". Try again or use another RPC."
  }
};
