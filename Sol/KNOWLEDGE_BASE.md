# 🧠 ApexPredator — Knowledge Base

> Errores resueltos, gotchas de las APIs y lecciones aprendidas. Cada entrada incluye **causa**, **solución** y **cómo se manifestó** para que un futuro Claude (o yo mismo) lo reconozca rápido.

---

## Errores resueltos — EVM (multi-chain)

### 17. `parseFloat(number) === NaN` con campos numéricos de Moralis (2026-05-04)
- **Síntoma**: `/top20` EVM mostraba holders sin portfolio. Filtraban todos los tokens (`usdValue >= 5` fallaba).
- **Causa**: Moralis devuelve `usdValue` como número JSON real (`205183.72`), no como string (`"205183.72"`). En el mapper teníamos `parseFloat(t.usdValue || "0")`. Con número directo, `parseFloat(205183.72)` devuelve `NaN` (espera string), y `NaN >= 5` es false.
- **Solución**: Usar `Number(t.usdValue ?? 0) || 0`. `Number()` acepta tanto number como string. El `|| 0` cubre `NaN`.
- **Lección global**: Moralis devuelve numéricos como JSON numbers. Todos los `parseFloat` en `moralis.ts` se cambiaron a `Number()`.

### 16. `Cannot read properties of undefined (reading 'toLowerCase')` en portfolios (2026-05-04)
- **Síntoma**: `/top20` EVM crasheaba en runtime al filtrar el portfolio del holder.
- **Causa**: Algunos tokens en `getEvmWalletTokens` venían sin `tokenAddress`. El filtro hacía `t.tokenAddress.toLowerCase()` directamente.
- **Solución**: Guard `if (!t.tokenAddress) continue` y fallback `tokenAddress: t.tokenAddress || t.token_address || ""` en el mapper.

### 15. `/top20` EVM crasheaba con `shortenEvmAddress(undefined)` (2026-05-04)
- **Síntoma**: `❌ Error fetching holders. Check address and chain.`
- **Causa**: Moralis ocasionalmente devuelve holders sin `ownerAddress` (ahora retorna también `owner_address` en algunos endpoints). El campo era undefined → `address.slice` rompía.
- **Solución**: `if (!h.ownerAddress) continue` en el loop. En el mapper de `moralis.ts`: `ownerAddress: h.ownerAddress || h.owner_address || h.address || ""`.
- **Lección**: Moralis es **inconsistente** entre snake_case y camelCase según endpoint. Siempre cubrir ambos.

### 14. `/top20 0xFEcb...` BSC token devolvía 0 holders (2026-05-04)
- **Síntoma**: `❌ No holders found. Check the contract address.` para un token que claramente tenía holders.
- **Causa**: `/top20` asumía `chain = "eth"` por defecto. El token era de BSC. Moralis devolvía `result: []` correctamente para ese contrato en eth.
- **Solución**: `detectEvmChain()` en `dexscreener.ts` consulta DexScreener, ordena pares por liquidez, mapea `chainId` (ethereum/bsc/base/...) a chain de Moralis (eth/bsc/base/...). Solo se ejecuta si el usuario no especificó chain explícitamente.

### 13. `/kol` EVM solo encontraba intersección entre holders actuales (2026-05-04)
- **Síntoma**: KOLs que compraron ambos tokens y vendieron uno no aparecían.
- **Causa**: La intersección era solo entre top 500 holders → por definición excluye ex-holders.
- **Solución**: Añadir `getEvmTokenBuyers()` que pagina ERC-20 transfers (10 páginas × 100 = ~1000 últimas transfers). Unión `buyers ∪ holders` y luego intersección entre tokens. Para cada wallet, indica si aún tiene el token (`% / USD`) o `<i>sold / transferred</i>`.

### 12. Moralis API key "Token is invalid format" desde Node (2026-05-04)
- **Síntoma**: `{"message":"Token is invalid format"}` con una key copiada.
- **Causa**: La key era solo el header del JWT (`eyJhbGc...JWTfQ` — 38 chars). Una API key de Moralis JWT real tiene 3 partes separadas por `.` y mide ~230+ caracteres.
- **Solución**: Copiar la key completa desde admin.moralis.io con el botón "Copy" (selección manual a veces se trunca).

### Cloudflare 1010 al testear Moralis desde Python local (2026-05-04)
- **Síntoma**: `403 error code: 1010, browser_signature_banned` desde `urllib`.
- **Causa**: Cloudflare bloquea User-Agents de scripting (Python, curl sin headers).
- **Solución**: Para tests, ejecutar el fetch desde Node en el VPS via paramiko (`ssh → node script.mjs`). Funciona sin User-Agent custom porque Node.js fetch envía `node` que sí está permitido.

---

## Errores resueltos — Solana

### 11. `/start` y `/help` rompían con MarkdownV2 (2026-04-15)
- **Síntoma**: `400: Character '>' is reserved and must be escaped`.
- **Causa**: El texto contenía `<ca1>` con `<` `>` que MarkdownV2 requiere escapar incluso dentro de backticks.
- **Solución**: Migrar a `parse_mode: "HTML"`. Usar `&lt;` `&gt;`. HTML es más robusto para textos de ayuda con `<param>`.

### 10. `/kol` con 1 CA devolvía 0 wallets (2026-04-15)
- **Síntoma**: "No wallets found holding all 1 tokens. 0 dust/bot wallets were filtered."
- **Causas**: (a) Helius API key agotada — devolvía silenciosamente 0. (b) Filtro dust 0.005% demasiado agresivo.
- **Soluciones**: (a) `throw` explícito cuando `json.error` — en `helius.ts`. (b) Con 1 CA, threshold = 0. Con 2-3 CAs, 0.001%.

### 9. `/wallet` Solana mostraba "FUNGIBLE" en vez del símbolo (2026-04-15)
- **Causa**: Helius Enhanced API devuelve `tokenStandard: "Fungible"` en `tokenTransfers`, no el símbolo.
- **Solución**: Resolver símbolos post-proceso vía DexScreener batch (`/latest/dex/tokens/<mint1>,<mint2>,...`, hasta 30 mints/llamada). Fallback a primeros 6 chars del mint si DexScreener no tiene par para ese token.

### 8. `/wallet` Solana mostraba SOL amounts ~0 en todos los trades (2026-04-15)
- **Síntoma**: "In: 0.00 SOL → Out: 0.00 SOL" en todos los trades.
- **Causa**: El SOL del swap NO está en `nativeTransfers` — ahí solo van fees/rent (~0.002 SOL). El SOL real está en `tokenTransfers` con `mint === "So111...112"` (wSOL).
- **Solución**: Filtrar `tokenTransfers` por `mint === SOL_MINT` y `fromUserAccount/toUserAccount === address`.

### 7. `/hmap` mostraba texto en vez de imagen (2026-03-16)
- **Causa**: Necesitábamos PNG real como Mugetsu.
- **Solución**: quickchart.io (free, sin key) con POST → PNG binary → `replyWithPhoto(InputFile(buffer, 'heatmap.png'))`. Fallback a texto si falla.

### 6. `/early` no mostraba compradores (2026-03-16)
- **Causas**: (a) URL pump.fun cambió. (b) `sol_amount` venía a veces en lamports, otras en SOL.
- **Solución**: Multi-endpoint fallback (`frontend-api.pump.fun`, `client-api-2-74b1891ee9f9.herokuapp.com`). Detectar `sol_amount > 1000` → lamports → dividir entre 1e9.

### 5. `/funded` no encontraba el funder real (2026-03-16)
- **Causa**: Buscábamos en los 20 signatures más RECIENTES, pero el primer funder está en la transacción más ANTIGUA.
- **Solución**: Obtener 1000 signatures (newest-first), tomar los últimos 5 (oldest), parsear con Helius Enhanced API que devuelve `nativeTransfers[]` limpio.

### 4. `/bundle` no detectaba bundles (2026-03-16)
- **Causa**: `getSignaturesForAddress(mintAddress)` devuelve tx que modifican la cuenta del MINT (minting), NO compras. Las compras van contra el pool de Raydium/pump.fun.
- **Solución**: pump.fun trades API (agrupar por timestamp = mismo bundle). Fallback a Helius Enhanced API analizando transfers del token en early slots.

### 3. Cluster A "0.000 SOL" falso positivo en `/snipers` (2026-04-15)
- **Causa**: Wallets con funder desconocido (`fundingAmount=0`) caían todas en el mismo cluster por `sameAmount(0, 0)`.
- **Solución**: Guard `s.fundingAmount > 0.0001` en el clustering por amount. Cluster prioritario adicional: wallets que sniped 2+ tokens (más fuerte que el match por amount).

### 2. TypeScript `unknown` en `fetch().json()` (2026-03-16)
- **Causa**: `res.json()` es `Promise<unknown>` en strict mode.
- **Solución**: Cast `(await res.json()) as any`.

### 1. Conflicto de instancias múltiples de grammY (2026-03-16)
- **Síntoma**: `409: Conflict: terminated by other getUpdates request`.
- **Causa**: Dos procesos node con el mismo TELEGRAM_BOT_TOKEN haciendo long polling.
- **Solución**: `Get-Process node | Stop-Process -Force` (Win) o `pkill node` (Linux).
- **Prevención**: Un solo deploy. Antes de `npm run dev` matar el proceso del VPS, o viceversa.

---

## Lecciones de las APIs

### Helius (Solana)

- **Endpoint Enhanced**: `https://api.helius.xyz/v0/addresses/{addr}/transactions?api-key=...&limit=100&type=SWAP`
  - Filtra por tipo (SWAP, TRANSFER, ADD_LIQUIDITY, REMOVE_LIQUIDITY)
  - Paginación con `before=<lastSig>`
- **DAS API** (`getAssetsByOwner`): rate limit separado, 2 RPS en free
- **`getTokenAccounts`**: holders de un mint, `cursor` para paginar
- Montos en raw units → dividir por `10^decimals`
- `token_info.price_info.total_price` ya viene en USD cuando está disponible
- **wSOL mint**: `So11111111111111111111111111111111111111112` — los swaps con SOL aparecen aquí en `tokenTransfers`, no en `nativeTransfers`
- **Fresh wallet criteria**: `<20 tx` o `<30 días` desde la primera transacción

### Moralis (EVM)

- **Base URL**: `https://deep-index.moralis.io/api/v2.2`
- **Header**: `X-API-Key: <jwt>` (~230 chars, formato `eyJ...`)
- **Endpoints clave**:
  - `/wallets/{addr}/swaps?chain=eth&limit=100` — historial de swaps con tokenIn/Out y `totalValueUsd`
  - `/{addr}/erc20/transfers?chain=...` — transfers ERC-20 (filtrar `fromAddress === addr` para outgoing)
  - `/wallets/{addr}/tokens?chain=...` — balances actuales con `usdValue` y `percentageRelativeToTotalSupply`
  - `/erc20/{token}/owners?chain=...&limit=100&order=DESC` — top holders
  - `/erc20/{token}/transfers?chain=...&limit=100&order=DESC&cursor=...` — transfer history (para buyers acumulados)
- **Chain strings**: `eth | bsc | base | arbitrum | polygon | avalanche | optimism` o hex (`0x1`, `0x38`, `0x2105`, `0xa4b1`)
- **Numéricos vienen como `number` JSON, no string** — usar `Number()`, no `parseFloat()`
- **Snake_case vs camelCase** — usar fallback `h.ownerAddress || h.owner_address`
- **Native token placeholder**: `0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee` (ETH/BNB/MATIC en `tokenIn/Out`)
- **Free tier**: 40K CU/día. `/wallet` ~50 CU, `/top20` ~60 CU, `/kol` ~80-200 CU

### DexScreener (cross-chain)

- **Endpoint**: `https://api.dexscreener.com/latest/dex/tokens/{addr1},{addr2}` (hasta 30 mints batch)
- **Sin auth, sin rate limit estricto**, gratis
- **Auto-detect chain**: ordenar `pairs[]` por `liquidity.usd` desc, tomar `chainId` del primero
- **`chainId` mapping a Moralis chain**: ethereum→eth, bsc→bsc, base→base, arbitrum→arbitrum, solana→solana, etc
- **Símbolos reales**: `pair.baseToken.symbol` (Helius/Moralis a veces los pierden)
- **Útil incluso para Solana**: resuelve "FUNGIBLE" → símbolo real

### Jupiter Price API (Solana)

- `https://api.jup.ag/price/v2?ids=<mint1>,<mint2>,...`
- Hasta ~100 mints/request, sin key
- Respuesta: `{ data: { [mint]: { price: "0.001234" } } }`

### Telegram (grammY)

- **Límite mensaje**: 4096 chars → paginar con `splitMessage()`
- **MarkdownV2**: escapar `_*[]()~>#+\-=|{}.!`
- **HTML preferido** para textos con `<param>` — escapar solo `&`, `<`, `>`
- **`editMessageText` falla silenciosamente** si el texto no cambió
- **Long polling**: 1 instancia por bot token (error 409 si hay dos)
- **Rate limit Telegram**: 30 msg/seg global, 20 msg/min por grupo

### CoinGecko

- Throttle ~1 RPS sin key
- `/simple/price?ids=ethereum,binancecoin&vs_currencies=usd` para precios nativos EVM

### pump.fun

- **Endpoints**: `frontend-api.pump.fun` y `client-api-2-74b1891ee9f9.herokuapp.com` — múltiples fallbacks
- **`sol_amount`** puede ser lamports o SOL — detectar `>1000` para asumir lamports
- **Frágil** — pueden cambiar URL/formato sin previo aviso

---

## Patrones generales del proyecto

### Detección de chain unificada

Todos los comandos cross-chain (`/wallet`, `/top20`, `/kol`) usan este patrón:

```typescript
const chain = detectChain(address);  // "solana" | "evm" | null
if (chain === "evm") return handleEvmHandler(...);
// Caso Solana → fallthrough al handler original
```

`detectChain()` está en `utils/evm.ts`. Para EVM con chain ambigua, `detectEvmChain()` (en `dexscreener.ts`) consulta DexScreener.

### Cache TTL en memoria

`utils/cache.ts` — Map con TTL de 5 min default. Reduce llamadas API ~80% en uso normal. Cache key incluye chain: `moralis:swaps:bsc:0x...`.

### Auto-fallback de campos

Para APIs inconsistentes (Moralis, pump.fun) siempre usar:

```typescript
field: a.fooBar ?? a.foo_bar ?? defaultValue
```

### Health check al arrancar

`index.ts` llama `getSlot` de Helius al inicio. Si falla, loguea y sigue (no bloquea). Detecta API key agotada en segundos en vez de esperar al primer comando.

---

## Referencia: Mugetsu Bot (competencia)

| Comando Mugetsu | ApexPredator | Estado |
|---|---|---|
| `/top_holders` ($25K floor) | `/top20` `/top50` ($5 floor) | ✅ Multi-chain |
| `/common_top_traders` (multi-token) | `/kol` (hasta 3 SOL, N en EVM) | ✅ Multi-chain |
| `/wallet_analyzer` (300 tx PnL) | `/wallet` | ✅ Multi-chain |
| `/bundle_check` | `/bundle` | ✅ Solana |
| `/fresh` (wallets nuevas) | `/fresh` | ✅ Solana |
| `/funded` (origen fondeo) | `/funded` | ✅ Solana |
| `/early-pf-wallets` | `/early` | 🟡 Frágil (pump.fun) |
| `/twitter_reuse` | `/twitter` | ❌ Stub |
| `/site_check` | `/site` | ❌ Stub |
| `/check_dex` | `/dex` | ✅ Cross-chain |
| `/holder_scan` | `/hscan` | 🟡 Frágil |
| `/reverse_image_search` | `/img` | ✅ |
| `/hmap` | `/hmap` | ✅ |
| `/graduated_stats` | `/graduated` | 🟡 Frágil |

**Diferencias clave:**
- Mugetsu cobra 1 SOL/mes → ApexPredator gratis
- Mugetsu solo Solana en pricing → ApexPredator multi-chain
- Mugetsu floor $25K → ApexPredator $5 (mucho más sensible)

---

## VPS / deploy

### Datos del VPS

- **Vultr Frankfurt**: `95.179.243.31`, `root` / `4mZ=hCCo49xD3#DK`
- **Path**: `/opt/apexpredator/`
- **Servicio systemd**: `apexpredator.service`
- **Otros servicios convivientes** (no tocar): gmgn-terminal, livo-sniper, pkguardian, prophet (Postgres), polymarket-tracker, ogbot

### Procedimiento de deploy

```bash
# 1. Push a GitHub
git push

# 2. Pull + build + restart en VPS (vía paramiko)
ssh: cd /opt/apexpredator && git pull && cd Sol && npm install && npm run build
ssh: systemctl restart apexpredator
ssh: systemctl is-active apexpredator   # → "active"
```

### Conexión al VPS

**Siempre paramiko, nunca PowerShell ni CLI con password.**

```python
import paramiko, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
ssh = paramiko.SSHClient()
ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
ssh.connect('95.179.243.31', username='root', password='4mZ=hCCo49xD3#DK')
```

### Logs

- `journalctl -u apexpredator -n 30 --no-pager --output=cat`
- Filtrar `🐺` (UnicodeEncodeError en Windows cp1252): añadir `| grep -v wolf` o redirigir stdout a UTF-8
- Errores recientes: `journalctl -u apexpredator --since "10 minutes ago" | grep -iE "error|throw|TypeError"`

### Files / SFTP

Para escribir scripts de test en el VPS, usar SFTP en vez de here-docs (los heredocs con triple comillas Python rompen):

```python
sftp = ssh.open_sftp()
with sftp.open('/tmp/test.mjs', 'w') as f:
    f.write(textwrap.dedent('''...'''))
sftp.close()
```
