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
