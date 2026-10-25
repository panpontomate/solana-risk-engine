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

## Línea de comandos

```sh
node examples/cli.js <token-o-wallet>
node examples/cli.js holders <mint> --rpc "https://mainnet.helius-rpc.com/?api-key=..."
```

## Tests

```sh
npm test
```
