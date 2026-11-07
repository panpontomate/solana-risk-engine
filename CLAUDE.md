# solana-risk-engine — el motor (npm: `solana-risk-engine`)

Librería sin dependencias, funciona en Node y en el navegador. La usan la web (`C:\dev\escaner-solana`, vía jsDelivr) y el bot (`C:\dev\solana-risk-bot`, vía npm).

## Mapa
- `src/index.js` — punto de entrada; `src/i18n/` — textos es/en de cada señal (export `./i18n`).
- `src/risk.js` — semáforos y nivel; `holders.js` — concentración real; `markets.js` — liquidez; `rugcheck.js`, `launch.js` — creador y lanzamientos; `known.js`, `base.js` — emisores y wallets conocidas; `map.js` — On-chain Map; `pnl.js`, `wallet.js`, `confluence.js`.
- `bin/solana-risk.js` — CLI de ejemplo. `test/` — tests con cadena falsa (`fakechain.js`).

## Tests
`npm test` (`node --test test/*.test.js`). El test de i18n exige que cada señal tenga texto es y en.

## Publicar
1. Subir `version` en `package.json` y commit.
2. Etiqueta y push: el modo automático bloquea subir tags, así que lo hace el usuario con
   `! git tag vX.Y.Z; git push origin vX.Y.Z`
3. `.github/workflows/publicar.yml` pasa los tests y hace `npm publish`.
4. Después: cambiar la versión en la web (`index.html` de escaner-solana) y en el `package.json` del bot.

## Convenciones
- Cero dependencias.
- README en inglés (`README.md`) y español (`README.es.md`): actualizar los dos.
