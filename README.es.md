# solana-risk-engine (español)

Es el motor del Escáner de Wallets convertido en librería: análisis de riesgo explicable para tokens y wallets de Solana. No tiene dependencias, funciona en Node 18+ y en el navegador, y usa RPCs gratuitos si no se le da otro.

El README principal está en inglés ([README.md](README.md)) porque los grants y la mayoría de desarrolladores lo leen así. Las traducciones al español están en `src/i18n/es.js` y conservan los textos del escáner original.

## Uso rápido

```js
import { createScanner, explainLight, lightLabel, levelLabel } from "solana-risk-engine";

const scanner = createScanner();   // o createScanner({ rpcUrl: "https://mainnet.helius-rpc.com/?api-key=..." })
const r = await scanner.analyzeToken("JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN");

console.log(levelLabel(r, "es"));                       // "Riesgo bajo"
for (const l of r.lights) console.log(lightLabel(l.k, "es"), explainLight(l, "es"));
```

## Cinco niveles (0.6.0)

Además de `lvl`, cada token con mercado lleva `tier`: lo que **es** el token, de más fiable a menos. `lvl` no cambia.

- `DIAMOND` (diamante): está en la lista revisada a mano de SolFlag, grandes proyectos (`BIG_PROJECTS`: Jupiter, Jito, Pyth…) y emisores de confianza (Circle, Paxos…). Estar en la lista basta.
- `GREEN` (verde): ninguna alerta y 7 días o más de mercado. Un meme puede ser verde, nunca diamante.
- `YELLOW` (amarillo): una alerta leve, algo que no se pudo comprobar o **menos de 7 días**: un recién nacido aún no ha demostrado nada y el amarillo es lo máximo que puede sacar (`tierCap: true`; `tierCapUntil`, cuándo acaba el techo).
- `ORANGE` (naranja): peligro sin trampa. Una alerta grave que no es trampa (liquidez muy baja, pocas wallets con casi todo) o dos o más leves.
- `RED` (rojo): una trampa (`TRAPS`: el creador puede crear más o sacar la liquidez, lanza en serie, liquidez o volumen falsos, copia de otro token…) o dos alertas graves.

En los recién nacidos rojo y naranja fracasan casi siempre; la diferencia es el tipo de peligro, no cuánto duran.

Las alertas se cuentan una a una y «nuevo» (`MKT_NEW`) no cuenta: la edad va por el techo. Un emisor que cambia sus claves sin revisar pierde el diamante. `tierLabel(r, "es")` y `tierNote(r, "es")` dan el nombre y una línea de explicación.

## Puntos por apartado (0.7.0)

Una meme, una acción tokenizada y un token DeFi no se miden igual. `scoreProfile(res, perfil)` (o `analyzeToken(client, mint, { perfil })`, que añade `res.perfil`) pone el token en uno de siete apartados — `meme`, `rwa`, `defi`, `juegos`, `ia`, `apps`, `otros` — y lo puntúa sobre una base de 50 con las reglas de su apartado: quién está detrás y sus reservas en los activos tokenizados; comisiones, ingresos, auditorías y hackeos en DeFi; actividad real en los juegos; código público en la IA; si el token gana con el negocio (recompras, quemas) en las apps. Es una función pura: lo que no está en la cadena llega en `perfil`, una entrada de un archivo diario (SolFlag lo hace con DefiLlama, Jupiter, GitHub y Streamflow). Sin él, un emisor conocido es `rwa` y lo demás se puntúa con las reglas de meme, que solo usan la cadena. Con las reglas de meme una wallet grande resta poco a poco (un punto por cada punto por encima del 15 %, hasta −40), y si una wallet de persona tiene `WALLET_CAP` (40 %) o más, el token sale como mucho NARANJA (`capWallet: true`). En la concentración, `w1a` es la dirección de esa wallet mayor.

Devuelve `{ap, pts, tier, cap, floor, trap, checks}`: `pts` llena una barra hasta 110 y `checks` da el color de cada chequeo (`suma`, `resta`, `grave`, `neutro`, `falta` = aún no lo sabemos, nunca cuenta). Reglas fijas: una trampa es rojo; diamante solo para la lista revisada a mano con 90 puntos o más, y la lista es como mínimo verde; lo nacido en una lanzadera se puntúa como meme (como mucho verde) y con menos de 7 días como mucho amarillo. `lvl` y `tier` no cambian.

## Volumen inflado (0.5.5)

Al analizar un token suelto con un mercado de menos de 90 días, el motor lee las últimas ~300 operaciones de su pool principal (GeckoTerminal, una petición). Si el 80 % o más del volumen es de wallets que compran y venden lo mismo, sale `MKT_FAKE_VOLUME` en ámbar; en rojo si lo hacen 25 wallets o menos y las 3 mayores mueven el 75 % o más. En tokens veteranos los bots de arbitraje son normales y no se mira; a un emisor verificado tampoco. `noGecko` lo desactiva.

## Línea de comandos

```sh
npx solana-risk <token-o-wallet>
npx solana-risk holders <mint> --rpc "https://mainnet.helius-rpc.com/?api-key=..."
```

## Tests

```sh
npm test
```
