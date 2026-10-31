// api.mainnet-beta.solana.com answers 403 to anything coming from a browser. PublicNode serves almost
// everything (accounts, signatures, transactions) quickly, but blocks token-by-owner and largest-holder
// queries. Those go to Solana Vibe Station, which accepts them without a key but only at ~1 per second,
// so they go through a queue (see client.js). With your own RPC URL everything goes to that URL.
export const PUBLIC_RPC = "https://solana-rpc.publicnode.com";
export const VIBE_RPC = "https://public.rpc.solanavibestation.com";
export const DEX = "https://api.dexscreener.com/tokens/v1/solana/";
// SolFlag's wallet base (see base.js)
export const WALLET_BASE_URL = "https://solflag.com/datos/base.json";
export const DEX_SEARCH = "https://api.dexscreener.com/latest/dex/search?q=";
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

// Real companies with no token of their own on Solana: a memecoin called "Spotify" is not Spotify. Clubs
// with an official fan token on Solana (Barcelona, PSG, Juventus...) and Western Union (USDPT) are left out. Their
// genuine tokenized shares come from an issuer (xStocks, Backpack...) and are typed TOKENIZED, so they
// are never matched. Names only: stock tickers clash with real crypto symbols (META, COIN...). A name that
// is also an everyday word or a first name (Shell, Target, Puma, Mango, Oracle, Corona, Hermes...) is left
// out, since a token called just that would be marked HIGH. brandKey() normalises both sides
export function brandKey(s) {
  return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[$'’.\-_]/g, " ").replace(/\s+/g, " ").trim();
}
const BRAND_NAMES = [
  // tech, internet and AI
  "Apple", "Google", "Alphabet", "Microsoft", "Amazon", "Nvidia", "Facebook", "Instagram", "WhatsApp", "Netflix",
  "Spotify", "Shopify", "TikTok", "YouTube", "OpenAI", "ChatGPT", "Anthropic", "DeepSeek", "Midjourney", "Samsung",
  "Sony", "Nintendo", "PlayStation", "Xbox", "Intel", "Qualcomm", "Broadcom", "Salesforce", "Adobe", "IBM", "Cisco",
  "Dell", "Lenovo", "Huawei", "Xiaomi", "OnePlus", "Motorola", "Nokia", "Snapchat", "Pinterest", "Reddit", "LinkedIn",
  "Twitter", "Telegram", "Discord", "Twitch", "Dropbox", "Airbnb", "Uber", "Lyft", "DoorDash", "Expedia", "eBay",
  "Alibaba", "AliExpress", "Temu", "Shein", "Tencent", "Baidu", "ByteDance", "Palantir", "SpaceX", "Starlink",
  "Neuralink", "Roblox", "Fortnite", "Epic Games", "Minecraft", "Ubisoft", "Activision", "Rockstar Games",
  "Electronic Arts", "Panasonic", "Philips", "Siemens", "Bosch", "Nikon", "GoPro", "Bose", "Dyson", "Garmin",
  "Fitbit", "Peloton", "Logitech", "Razer", "Asus", "Xerox", "Vodafone", "Verizon", "AT&T", "T-Mobile", "Comcast",
  "Movistar", "Telefonica", "Wikipedia", "Duolingo",
  // finance and payments
  "Visa", "Mastercard", "PayPal", "American Express", "JPMorgan", "Goldman Sachs", "Morgan Stanley", "BlackRock",
  "Vanguard", "Fidelity", "Citibank", "Wells Fargo", "Bank of America", "HSBC", "Barclays", "Santander", "BBVA",
  "CaixaBank", "Deutsche Bank", "Revolut", "Stripe", "Klarna", "Robinhood", "Charles Schwab", "Nasdaq", "NYSE",
  "Berkshire Hathaway", "MoneyGram", "Venmo", "Cash App", "Zelle", "Monzo", "N26", "Nubank",
  "Mapfre", "Bankinter",
  // crypto companies with no token on Solana
  "Coinbase", "Binance", "Bybit", "OKX", "KuCoin", "Bitget", "Upbit", "Bithumb", "Bitpanda", "eToro",
  "MicroStrategy", "Grayscale", "MetaMask", "Trezor", "Solflare",
  // fashion, retail and consumer goods
  "Nike", "Adidas", "Reebok", "New Balance", "Under Armour", "Zara", "Inditex", "H&M", "Uniqlo", "Levi's", "Lacoste",
  "Ralph Lauren", "Tommy Hilfiger", "Calvin Klein", "Gucci", "Louis Vuitton", "Chanel", "Prada", "Dior", "Versace",
  "Balenciaga", "Burberry", "Fendi", "Givenchy", "Yves Saint Laurent", "Armani", "Dolce & Gabbana", "Rolex",
  "Cartier", "Patek Philippe", "Audemars Piguet", "Swatch", "Ray-Ban", "Sephora", "L'Oreal", "Nivea", "Gillette",
  "Colgate", "Pampers", "IKEA", "Lego", "Mattel", "Barbie", "Hot Wheels", "Hasbro", "Pokemon", "Hello Kitty",
  "Sanrio", "Walmart", "Costco", "Carrefour", "Mercadona", "El Corte Ingles", "Lidl", "Aldi", "Tesco",
  "Home Depot", "Best Buy", "7-Eleven", "Wallapop", "Glovo", "Cabify",
  // food and drink
  "Coca-Cola", "Pepsi", "Red Bull", "Monster Energy", "Starbucks", "McDonald's", "Burger King", "KFC", "Domino's",
  "Pizza Hut", "Taco Bell", "Wendy's", "Chipotle", "Dunkin", "Krispy Kreme", "Nestle", "Nutella", "Ferrero",
  "Doritos", "Pringles", "Cheetos", "Heinz", "Kellogg's", "Heineken", "Budweiser", "Guinness",
  "Jack Daniel's", "Johnnie Walker", "Hennessy", "Moet", "Dom Perignon", "Smirnoff", "Bacardi", "Gatorade", "Fanta",
  "Nespresso", "Haribo", "Snickers", "M&M's", "Hershey", "Cadbury", "Lindt",
  // cars and motorbikes
  "Tesla", "Ferrari", "Lamborghini", "Porsche", "Bugatti", "McLaren", "Bentley", "Rolls-Royce", "Aston Martin",
  "Maserati", "BMW", "Mercedes-Benz", "Audi", "Volkswagen", "Toyota", "Honda", "Nissan", "Hyundai", "Chevrolet",
  "Cadillac", "Volvo", "Peugeot", "Renault", "Harley-Davidson", "Ducati", "Yamaha", "Kawasaki", "Suzuki", "Rivian",
  "Polestar",
  // media, entertainment and sport
  "Disney", "Pixar", "Marvel", "Warner Bros", "HBO", "Paramount", "Universal Studios", "DreamWorks", "Hulu",
  "Fox News", "CNN", "ESPN", "National Geographic", "Playboy", "Nickelodeon", "Cartoon Network",
  "Star Wars", "NBA", "NFL", "FIFA", "UEFA", "WWE", "Formula 1", "Real Madrid", "Manchester United",
  "Bayern Munich",
  // travel, transport, energy and health
  "Emirates", "Qatar Airways", "Ryanair", "Lufthansa", "Boeing", "Airbus", "Marriott", "FedEx", "DHL",
  "ExxonMobil", "Chevron", "Aramco", "Repsol", "Iberdrola", "Pfizer", "Moderna", "Johnson & Johnson",
  "Procter & Gamble", "Unilever"
];
// Products that companies (or their partners) really put on Solana carry the name too: exchange staked SOL,
// fund shares, wrapped BTC. They trade for weeks with real liquidity, while copies are new and thin, so a
// market at least this old AND this deep is not checked for brand names
export const BRAND_MATURE_DAYS = 30;
export const BRAND_MATURE_LIQ = 100000;
// COPYCAT: the token taken as the original must be a real market. Farms relaunch the same name and ticker
// many times a day, so the "oldest" is often another dead copy from an hour ago (registry 29/10: 209 of 320
// new tokens flagged). Below this liquidity the older token is not something worth copying
export const COPY_MIN_LIQ = 10000;
export const BRANDS = Object.fromEntries(BRAND_NAMES.map(function (n) { return [brandKey(n), n]; }));

// Official tokens put on Solana by exchanges and by Socios.com, by mint address (a copy always has another
// address). They are bought and sold mostly on their exchange, so Solana pools are tiny and the issuer's
// custody wallet holds most of the supply: read as a stranger's token that gave HIGH (bnSOL, the Barcelona
// fan token). They are shown as dependency on the issuer, like ISSUERS below
export const OFFICIAL_TOKENS = {
  BNso1VUJnh4zcfpZa6986Ea66P6TCp59hvtNJ8b1X85: "Binance",   // Binance Staked SOL
  Bybit2vBJGhPF52GBdNaQfUJ6ZpThSgHBobjWZpLPb4B: "Bybit",   // Bybit Staked SOL
  bgSoLfRx1wRPehwC9TyG568AGjnf1sQG1MYa8s3FbfY: "Bitget",   // Bitget Staked SOL
  "7cBuurYDdaqxnem7KyMTci6SWhjJKroZ6NUjqH2ewEPB": "MEXC",   // MEXC Staked SOL
  CDCSoLckzozyktpAp9FWT3w92KFJVEUxAU7cNu2Jn3aX: "Crypto.com",   // Crypto.com Staked SOL
  FDLkS4zH5rGmD7q7qGfzhmzPgQJ88jcX1JFT5nfdNTjg: "Socios.com (Chiliz)",   // Olympique de Marseille Fan Token
  BjXGwMnWWUkS9JrXEkkamszu4oX8oqo3kNqFr3ifNk1F: "Socios.com (Chiliz)",   // Napoli Fan Token
  BX8VbHBf8DUHeGJjJsSW2HCviGyQSF5SVCEnN7vXUkwM: "Socios.com (Chiliz)",   // Argentine Football Association Fan Token
  AiYi7HyVVXnDSuj8BoPirDsuuWgddeKkD5MQN35VpwNz: "Socios.com (Chiliz)",   // Portugal National Team Fan Token
  HD9i9C2Pw6hWXm354i3SWkYG8ZtfikUJn2bNPzwQZcEK: "Socios.com (Chiliz)",   // SL Benfica Fan Token
  cbbtcf3aa214zXHbiAZQwf4122FBYbraNdFqgw4iMij: "Coinbase",   // Coinbase Wrapped BTC
  gtBTCGWvSRYYoZpU9UZj6i3eUGUpgksXzzsbHk2K9So: "Gate",   // Gate Wrapped BTC
  CtzPWv73Sn1dMGVU3ZtLv9yWSyUAanBni19YWDaznnkn: "OKX",   // OKX Wrapped BTC
  BtjXf3LA7Z3jxAcQkKUqKYpLFS5B7GuB7pfjzeas1tdB: "Socios.com (Chiliz)",   // OG Fan Token
  "6VdpC1hcx7byFtJ5M6Xhspa6Uup5rZHruzXvuJhXAyXm": "Socios.com (Chiliz)",   // Atletico Madrid Fan Token
  EDzhmkPa5gToYGowjH66xycCRgPmfWNzfqpXdCzsYb8M: "Socios.com (Chiliz)",   // Galatasaray Fan Token
  "82DNsTK61ZrgCHP6pfP32Eubcsp9h38d64E6X9ETEBBe": "Socios.com (Chiliz)",   // FC Barcelona Fan Token
  "5eyib4qghYGHNh7VvxSFGYLFJSanjq9hug9fR52kksnm": "Socios.com (Chiliz)",   // Paris Saint-Germain Fan Token
  "3cVuTnMj8FeqK82PDgK4JzKnLP7LM6GauqTyqnxtcSk1": "Socios.com (Chiliz)",   // AS Roma Fan Token
  HE6bLNs16qgQo2jVSMXDSCnxQahjdVrww7qQPrHrZtEw: "Socios.com (Chiliz)",   // Juventus Fan Token
  "8WbNQtY7QmXMVKJFTSqFudierVZZtbuoyeepZEqJ1B2w": "Socios.com (Chiliz)",   // Manchester City Fan Token
  H5qGPniSX2uCNtAnxr7RpdfFAZcGkr6dknjgpa1AKHe1: "Socios.com (Chiliz)",   // AC Milan Fan Token
  Dst93spXQEXxFzwYbFrQRnFYBYpw7AzB2QyALEeP4NGQ: "Socios.com (Chiliz)",   // Arsenal Fan Token
  HagS3VmAuhx5QJnHcuMAJF4wwVDE58CiX5SFZCYFrVe: "Socios.com (Chiliz)",   // Inter Milan Fan Token
  AMnbxhGifp3gm2YsNwmfcF2ZCLsZN6iP3LdzBPZgGpzW: "Socios.com (Chiliz)",   // Trabzonspor Fan Token
  GDNoEjfSAUAvManoEaT3vStGcvwKkcUcSTvUwfvwhqXf: "Socios.com (Chiliz)",   // Tottenham Hotspur FC Fan Token
  FG44Jffowai8hqQifkwtNLbADkH3EjG5txMc54yaJ4cN: "Socios.com (Chiliz)",   // UFC Fan Token
};

// Known issuers of tokenized assets: every key that controls their tokens (mint, freeze, permanent delegate,
// hook, pause, scaling). A token is theirs only if ALL its control keys are in the list, so copying one key
// (anyone can hand the mint authority to someone else's wallet) is not enough. Their control is the point of
// the product: it is shown as dependency on the issuer, not as a creator who can rug
export const ISSUERS = [
  { name: "xStocks (Backed)", keys: [
    "7pt9tkctJPK7PPNQJ77GKg8ZffSF6QxoMiCFYHxrtaCj",   // mint
    "JDq14BWvqCRFNu1krb12bcRpbGtJZ1FLEakMw6FdxJNs",   // freeze and pause (program)
    "5aMNNLQJwAEeoemTEMkv5NVjqKwvvefRYCQ5Z67HFvEq",   // permanent delegate, transfer hook, confidential transfers
    "S7vYFFWH6BjJyEsdrPQpqpYTqLTrPRK6KW3VwsJuRaS"     // share-split multiplier (scaled UI amount)
  ] }
];

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
