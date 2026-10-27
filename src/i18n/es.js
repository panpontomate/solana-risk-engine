// Spanish texts: the same wording the original single-file scanner used
function usd(n) {
  if (!n) return "0 $";
  if (n < 0.01) return "<0,01 $";
  // de-DE instead of es-ES: same format (dot thousands, comma decimals), but es-ES does not group
  // 4-digit numbers and "6494 $" showed next to "22.505 $"
  return n.toLocaleString("de-DE", { minimumFractionDigits: n < 1000 ? 2 : 0, maximumFractionDigits: n < 1000 ? 2 : 0 }) + " $";
}
function pct(n) { return Math.round(n) + "%"; }
function short(a) { return a.slice(0, 4) + "…" + a.slice(-4); }
function prog(d) { return d && d.prog >= 20 ? ". Los pools y programas guardan el " + pct(d.prog) : ""; }

const EXT = {
  permanentDelegate: "El emisor puede mover o quemar tus tokens (delegado permanente). Es normal en acciones tokenizadas, pero hay que confiar en el emisor",
  transferHook: "Tiene transfer hook: ejecuta código externo en cada transferencia",
  transferFeeConfig: "Cobra una comisión en cada transferencia",
  nonTransferable: "No se puede transferir",
  defaultAccountState: "Las cuentas nuevas pueden crearse congeladas"
};

export default {
  fmt: { usd: usd, pct: pct, short: short },
  signals: {
    NO_INFO: () => "No se pudo leer la información del token",
    MINT_BY_PROGRAM: () => "El mint lo controla un programa (suele ser un puente o un protocolo): hay que confiar en ese código",
    MINT_ACTIVE: (d) => "El creador todavía puede crear más tokens (mint activo" + (d && d.byWallet ? ", en manos de una wallet" : "") + ")",
    FREEZE_BY_PROGRAM: () => "El freeze lo controla un programa: puede congelar cuentas según su código",
    FREEZE_ACTIVE: (d) => "El creador puede congelar cuentas (freeze activo" + (d && d.byWallet ? ", en manos de una wallet" : "") + ")",
    EXTENSION: (d) => EXT[d.ext] || ("Extensión " + d.ext),
    NO_MARKET: () => "No hay mercado en DexScreener (sin precio ni liquidez)",
    MARKET_UNCHECKED: () => "No se pudo consultar el mercado de este token (fallo de red al conectar con DexScreener): vuelve a analizarlo para comprobarlo",
    KNOWN_TOKEN: () => "Token muy conocido",

    CTL_MINT_ACTIVE: () => "El creador puede crear más tokens (mint activo)",
    CTL_FREEZE_ACTIVE: () => "El creador puede congelar cuentas (freeze activo)",
    CTL_TRANSFER_HOOK: () => "Ejecuta código externo en cada transferencia",
    CTL_TRANSFER_FEE: () => "Cobra una comisión en cada transferencia",
    CTL_NON_TRANSFERABLE: () => "No se puede transferir",
    CTL_DEFAULT_FROZEN: () => "Las cuentas nuevas pueden crearse congeladas",
    CTL_ONLY_PROGRAMS: () => "Solo hay autoridades controladas por un programa (ver dependencia)",
    CTL_NONE: () => "Sin autoridades activas: nadie puede crear más ni congelar",
    CTL_SERIAL_CREATOR: (d) => "El creador ha lanzado " + d.n + " tokens más en las últimas 24 h (según RugCheck): es un lanzador en serie, que suele abandonar cada token en cuanto llegan compradores",
    CTL_CREATOR_HISTORY: (d) => "De los " + d.old + " tokens que el creador lanzó antes (hace más de 24 h), " + d.dead + " se quedaron por debajo de 10.000 $ de capitalización (según RugCheck): sus lanzamientos no suelen despegar",
    IMPOSTOR: (d) => "Se hace pasar por " + d.symbol + ": el " + d.symbol + " de verdad tiene otra dirección (" + short(d.real) + "). Es una copia, casi seguro una estafa",

    CON_SKIPPED: () => "Sin comprobar la concentración de holders",
    CON_UNAVAILABLE: () => "No se pudo comprobar la concentración de holders (el servicio no respondió; prueba otra vez en un rato)",
    CON_ALL_POOLS: (d) => "Casi todo el supply está en pools o programas" + prog(d),
    CON_OK: (d) => "Sin concentración preocupante (mayor wallet individual: " + pct(d.w1) + ")" + prog(d),
    CON_HIGH: (d) => "La mayor wallet individual tiene el " + pct(d.w1) + " y las 10 mayores el " + pct(d.w10) + " del supply" + prog(d),
    CON_UNSPLIT: (d) => "No se pudo separar pools de personas. La mayor cuenta tiene el " + pct(d.top1) + " del supply",

    MKT_LIQ_INFLATED: (d) => "Liquidez inflada: DexScreener dice " + usd(d.reported) + ", pero el pool solo tiene unos " + usd(d.real) + " en tokens de verdad (USDC, USDT o SOL). Es lo máximo que podrías sacar al vender",
    MKT_LIQ_VERY_LOW: (d) => "Liquidez muy baja (" + usd(d.liq) + ")",
    MKT_LIQ_LOW: (d) => "Liquidez baja (" + usd(d.liq) + ")",
    MKT_VOLUME_LOW: (d) => "Volumen de 24 h casi nulo (" + usd(d.vol) + ")",
    MKT_NEW: (d) => "Mercado muy nuevo (" + (d.days < 1 ? "menos de un día" : d.days + (d.days === 1 ? " día" : " días")) + ")",
    MKT_POSITION_HEAVY: (d) => "La posición de esta wallet equivale al " + pct(d.pct) + " de la liquidez: vender de golpe movería mucho el precio",
    MKT_LP_UNLOCKED: (d) => "Solo el " + pct(d.pct) + " de la liquidez está bloqueada o quemada (según RugCheck): el resto se puede retirar de golpe",
    MKT_LP_PARTLY_LOCKED: (d) => "Solo el " + pct(d.pct) + " de la liquidez está bloqueada o quemada (según RugCheck)",
    MKT_OK: (d) => "Liquidez " + usd(d.liq) + " · volumen 24 h " + usd(d.vol),

    DEP_PROGRAM_AUTHORITY: () => "Un programa controla el mint o el freeze (puente o protocolo): hay que confiar en su código",
    DEP_PERMANENT_DELEGATE: () => "El emisor puede mover o quemar tus tokens (delegado permanente): confías en el emisor",
    DEP_STABLE_ISSUER: () => "Su valor depende de quien la emite y la respalda",
    DEP_NONE: () => "No depende de un emisor ni de un puente"
  },
  offSolana: " y su mercado principal puede estar fuera de Solana",
  levels: {
    HIGH: "Riesgo alto", MEDIUM: "Riesgo medio", LOW: "Riesgo bajo", SPAM: "Probable spam",
    NO_DATA: "Sin comprobar", NO_MARKET: "Sin mercado", MEDIUM_DATA_ONLY: "Medio por falta de datos"
  },
  types: {
    STABLE: { label: "Stablecoin", note: "Se juzga por su liquidez y por la confianza en quien la emite; la concentración pesa menos." },
    TOKENIZED: { label: "Tokenizado o regulado", note: "Lo normal es que el emisor tenga control (delegado permanente). El riesgo real es confiar en el emisor y que haya liquidez para salir." },
    BRIDGED: { label: "Puenteado o de protocolo", note: "Lo normal es que un programa controle el mint. El riesgo real es confiar en ese puente y que su mercado en Solana sea pequeño, porque el principal puede estar en otra red." },
    CREATOR: { label: "Con control del creador", note: "Una wallet puede crear más tokens o congelar cuentas: es el patrón típico de estafa, así que se juzga con más dureza." },
    OPEN: { label: "Token abierto", note: "Sin autoridades del creador, típico de memecoins y proyectos nuevos. Pesan sobre todo la concentración en personas y la liquidez." }
  },
  lights: { control: "Control del creador", concentration: "Concentración", market: "Mercado y salida", dependency: "Dependencia" },
  missing: { control: "quién controla el token", concentration: "la concentración de holders", market: "el mercado", dependency: "la dependencia de un emisor" },
  steps: {
    address: "Comprobando la dirección…", wallet: "Leyendo la wallet…", markets: "Consultando precios y liquidez…",
    tokens: "Revisando tokens…", token: "Leyendo el token…", owners: "Buscando a quién pertenece cada cuenta…",
    kinds: "Distinguiendo wallets de pools y programas…", bots: "Separando personas de bots y exchanges…",
    funders: "Buscando wallets con el mismo origen de fondos…", exchangeSources: "Comprobando si el origen de cada grupo es un exchange…",
    creator: "Mirando quién creó el token (RugCheck)…", creatorTokens: "Revisando otros tokens del creador…",
    networks: "Comprobando cuánto tienen hoy las redes de wallets…", wallets: "Leyendo wallets…",
    pnl: "Estimando el resultado de cada wallet…", done: "Listo"
  },
  notes: {
    PNL_NO_HELIUS: "No se estimó el resultado de las wallets porque falta una clave de Helius.",
    PNL_PARTIAL: "No se pudo leer el historial de algunas wallets.",
    PNL_APPROX: "No se pudo obtener el histórico de precio de SOL: se usó el precio de hoy y los resultados pueden estar muy alejados de la realidad."
  },
  errors: {
    CANCELLED: () => "Cancelado.",
    INVALID_ADDRESS: () => "Esa dirección no parece de Solana. Son de 32 a 44 letras y números y no empiezan por 0x.",
    NOT_A_TOKEN: () => "Esa dirección no es un token.",
    IS_NFT: () => "Esa dirección es un NFT, no un token. El escáner no revisa NFTs.",
    NO_HOLDERS: () => "El RPC no devolvió datos de holders.",
    HELIUS_REQUIRED: () => "Para estimar el resultado hace falta una clave de Helius (o una URL de RPC de Helius con la clave).",
    SOL_PRICE: () => "No se pudo obtener el precio de SOL para calcular el resultado. Prueba otra vez dentro de un rato.",
    DEX_UNREACHABLE: () => "No se pudo conectar con DexScreener. Revisa tu conexión a internet y prueba otra vez.",
    TOO_FEW_WALLETS: (d) => d && d.filter ? "Solo " + d.n + (d.n === 1 ? " wallet cumple" : " wallets cumplen") + " el filtro de resultado (de " + d.total + " leídas)." : "Hacen falta al menos 2 wallets que se puedan leer.",
    TOO_FEW_TOKENS: () => "Pega al menos 2 direcciones de tokens de Solana.",
    NETWORK_PUBLIC: () => "Los servicios gratuitos de Solana no han respondido (a veces se saturan). Espera un minuto y prueba otra vez, o usa tu propia URL de RPC (Helius tiene plan gratuito).",
    NETWORK_OWN: () => "No se pudo conectar con tu URL de RPC. Revisa que esté bien copiada (con la clave al final).",
    UNKNOWN: (d) => "Algo ha fallado: " + d.message + ". Prueba otra vez o usa otro RPC."
  }
};
