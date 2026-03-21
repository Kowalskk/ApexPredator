# 🧠 ApexPredator_sol - Knowledge Base

> Este archivo es mantenido automáticamente por Claude. Cada vez que se resuelve un error difícil o se aprende algo importante sobre las APIs/Solana, se documenta aquí para evitar repetir los mismos problemas.

---

## Errores Resueltos

### 4. /bundle no detectaba bundles (2026-03-16)
- **Error**: Siempre devolvía "NOT BUNDLED"
- **Causa**: `getSignaturesForAddress(mintAddress)` devuelve tx que modifican la cuenta del MINT (minting), NO transacciones de compra. Las compras van contra el pool de Raydium/pump.fun
- **Solución**: Usar pump.fun trades API primero (agrupar por timestamp: mismo segundo = mismo slot = mismo bundle). Fallback a Helius Enhanced API analizando transfers del token en early slots

### 5. /funded no encontraba el funder real (2026-03-16)
- **Error**: Retornaba funder null para la mayoría de wallets
- **Causa**: Se obtenían los 20 signatures más RECIENTES y se buscaba el primer SOL ahí. Pero el primer funder está en la transacción MÁS ANTIGUA
- **Solución**: Obtener 1000 signatures (newest-first), tomar los últimos 5 (oldest), parsear con Helius Enhanced API que devuelve `nativeTransfers[]` limpio con `fromUserAccount` y `toUserAccount`

### 6. /early no mostraba compradores (2026-03-16)
- **Causa 1**: API de pump.fun puede haber cambiado URL o formato de respuesta
- **Causa 2**: `sol_amount` puede venir en lamports o SOL según la versión de la API
- **Solución**: Probar múltiples endpoints de pump.fun (`frontend-api.pump.fun` y `client-api-2-74b1891ee9f9.herokuapp.com`). Detectar si `sol_amount > 1000` para saber si son lamports y dividir entre 1e9

### 7. /hmap mostraba texto en vez de imagen (2026-03-16)
- **Causa**: Mugetsu genera imagen PNG del heatmap
- **Solución**: Usar quickchart.io (free, no API key) con POST request → devuelve PNG como binary. Enviar con `ctx.replyWithPhoto(new InputFile(buffer, 'heatmap.png'))`. Si falla, fallback a texto

### 1. Conflicto de instancias múltiples de grammY (2026-03-16)
- **Error**: `GrammyError: Call to 'getUpdates' failed! (409: Conflict: terminated by other getUpdates request)`
- **Causa**: Dos instancias del bot corriendo simultáneamente (npm run dev + node dist/index.js)
- **Solución**: Matar todos los procesos node (`taskkill /F /IM node.exe`) y arrancar una sola instancia
- **Prevención**: Nunca arrancar el bot sin verificar que no hay otra instancia corriendo

### 2. TypeScript `unknown` type en fetch responses (2026-03-16)
- **Error**: `TS18046: 'json' is of type 'unknown'`
- **Causa**: `res.json()` retorna `unknown` en TypeScript strict mode
- **Solución**: Cast con `(await res.json()) as any`

---

## Lecciones de APIs

### Helius
- `getTokenAccounts` devuelve `token_accounts[]` con `owner`, `amount`, `decimals` y paginación via `cursor`
- `getAssetsByOwner` (DAS API) tiene rate limit separado: 2 RPS en free tier vs 10 RPS general
- Los montos vienen en raw units (hay que dividir por `10^decimals`)
- El campo `token_info.price_info.total_price` en DAS ya viene en USD cuando está disponible

### Jupiter Price API
- Endpoint: `https://api.jup.ag/price/v2?ids=mint1,mint2,...`
- Máximo ~100 mints por request
- No requiere API key
- Responde con `{ data: { [mint]: { price: "0.001234" } } }`

### Telegram (grammY)
- Límite de mensaje: 4096 caracteres → hay que paginar
- MarkdownV2 requiere escapar: `_*[]()~>#+\-=|{}.!`
- `editMessageText` falla silenciosamente si el texto no cambió
- Long polling (`getUpdates`) solo permite 1 instancia por bot token

---

## Referencia de Competencia: Mugetsu Bot

### Comandos de Mugetsu que queremos replicar/mejorar:
| Comando Mugetsu | Equivalente ApexPredator | Estado |
|---|---|---|
| `/top_holders` (top 50 + holdings >$25K) | `/top20`, `/top50` (holdings >$5) | ✅ Implementado |
| `/common_top_traders` (wallets en múltiples tokens) | `/kol` (hasta 3 contratos) | ✅ Implementado |
| `/wallet_analyzer` (PnL últimas 300 tx) | `/wallet` | 🔜 Pendiente |
| `/bundle_check` (detección de bundling) | `/bundle` | 🔜 Pendiente |
| `/fresh` (wallets nuevas entre holders) | `/fresh` | 🔜 Pendiente |
| `/funded` (origen de fondeo de wallets) | `/funded` | 🔜 Pendiente |
| `/early-pf-wallets` (early buyers pump.fun) | `/early` | 🔜 Pendiente |
| `/twitter_reuse` (historial de handles) | `/twitter` | 🔜 Pendiente |
| `/site_check` (webs duplicadas) | `/site` | 🔜 Pendiente |
| `/check_dex` (verificar DEXScreener) | `/dex` | 🔜 Pendiente |
| `/holder_scan` (evolución de holders) | `/hscan` | 🔜 Pendiente |
| `/reverse_image_search` (Google Lens) | `/img` | 🔜 Pendiente |
| `/hmap` (heatmap del mercado) | `/hmap` | 🔜 Pendiente |
| `/graduated_stats` (tokens graduados pump.fun) | `/graduated` | 🔜 Pendiente |
| `/bundle_check` (beta) | `/bundle` | 🔜 Pendiente |

### Diferencias clave con Mugetsu:
- **Mugetsu cobra 1 SOL/mes** → ApexPredator será gratuito (al menos al inicio)
- **Mugetsu filtra holders con >$25K** → Nosotros usamos >$5 (más accesible)
- **Mugetsu analiza 300 tx por wallet** → Podemos hacer más con Helius
- **Mugetsu soporta ETH + SOL** → Nosotros solo SOL (por ahora)

---

## Notas Técnicas

### Cómo detectar bundling (para futuro /bundle)
- Un bundle es cuando múltiples wallets compran en el MISMO bloque/slot que el deploy
- Se detecta comparando el slot del deploy tx con las primeras compras
- Si varias wallets compraron en el mismo slot → probable bundle
- Helius `getSignaturesForAddress` puede obtener las primeras transacciones de un token

### Cómo detectar fresh wallets (para futuro /fresh)
- Una wallet "fresh" tiene pocas transacciones históricas (< 10-20)
- Se puede verificar con `getSignaturesForAddress` contando el total
- Red flag: si muchos top holders son wallets fresh → insider/coordinated

### Cómo analizar fundeo (para futuro /funded)
- Buscar la primera tx de SOL recibida por cada wallet holder
- Si múltiples wallets fueron fondeadas por la MISMA wallet → coordinación
- Helius `getSignaturesForAddress` + parsear transfers de SOL
