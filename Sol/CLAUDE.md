# ApexPredator_sol - Telegram Bot para Solana On-Chain Analytics

## Descripción
Bot de Telegram de analytics on-chain en Solana. Uso propio. Inspirado en Mugetsu bot pero gratuito y con umbral de holders >$5 (vs $25K de Mugetsu).

## Stack Tecnológico
- **Runtime**: Node.js 20+ con TypeScript
- **Bot Framework**: grammY
- **API Principal**: Helius (free tier: 1M credits/mes, 10 RPS)
- **Precios SOL/tokens**: Jupiter Price API (gratuito, sin API key)
- **Token info**: DexScreener API (gratuito)
- **Market data**: CoinGecko (gratuito, throttle 1 RPS)
- **Heatmap**: quickchart.io (gratuito, devuelve PNG)

## Arquitectura
```
src/
├── index.ts              # Entry point — arranca bot + health check Helius al inicio
├── bot.ts                # Registro de comandos, /start y /help en HTML parse mode
├── config.ts             # Variables de entorno
├── commands/             # Handlers (16 comandos)
├── services/
│   ├── helius.ts         # getTokenHolders, getTopHolders, getWalletAssets, findCommonHolders, checkIsLpWallet
│   ├── helius_extended.ts # getWalletPnl, checkWalletAge, getWalletFirstFunder, detectBundledWallets
│   ├── dexscreener.ts    # getTokenInfo, getTokenMetadata — también resuelve símbolos reales
│   ├── jupiter.ts        # getTokenPrices (batch, hasta 100 mints)
│   ├── coingecko.ts      # getTopCoinsHeatmap
│   ├── pumpfun.ts        # getRecentGraduated, getTokenEarlyBuyers (multi-endpoint fallback)
│   ├── labels.ts         # classifyWallet — 30+ CEX addresses, whale/fresh/degen emojis
│   └── birdeye.ts        # PLACEHOLDER — no implementado
├── utils/
│   ├── format.ts         # escMd, splitMessage, formatUsd, formatAmount
│   ├── solana.ts         # isValidSolanaAddress, shortenAddress
│   └── cache.ts          # TTL cache en memoria (5 min default)
└── types/index.ts        # Todos los tipos: TokenHolder, TokenHolding, WalletPnlResult, etc.
```

## Comandos — Estado real (2026-04-15)

### ✅ Funcionales
- `/kol <ca1> <ca2> [ca3]` — Intersección de holders. Con 1 CA muestra todos (sin filtro dust). Con 2-3 CAs filtra >0.001%. Dirección completa copiable debajo de cada wallet.
- `/top20 <ca>` / `/top50 <ca>` — Top holders con LP detection, whale/fresh emojis, supply real, portfolio por wallet
- `/wallet <address>` — PnL completo: swaps (SOL in/out desde wSOL en tokenTransfers), winrate, LP activity, transfers salientes. Símbolos resueltos via DexScreener batch.
- `/fresh <ca>` — Detecta wallets con <20 tx o <30 días entre top 50
- `/funded <ca>` — Detecta funders compartidos entre top 30
- `/bundle <ca>` — pump.fun trades (ventana 2s) + Helius fallback
- `/dex <ca>` — DexScreener price/mcap/vol/liq/socials
- `/hmap` — CoinGecko + quickchart.io PNG (fallback texto)
- `/img <ca>` — Link Google Lens con imagen del token

### 🟡 Funcionales pero frágiles
- `/early <ca>` — pump.fun frontend-api (puede caducar)
- `/graduated` — pump.fun frontend-api (mismo riesgo)
- `/hscan <ca>` — holderscan.io scraping no oficial

### ❌ Stubs
- `/twitter <handle>` — Solo link a memory.lol
- `/site <url>` — Solo link a sitelike.org

## Decisiones de Diseño
1. **`/start` y `/help` en HTML parse mode** — MarkdownV2 rompe con `<ca>` sin escapar. HTML es más robusto para textos con `<>`.
2. **SOL amount en swaps desde `tokenTransfers` con `mint === SOL_MINT`**, no desde `nativeTransfers` (que solo contiene fees/rent de ~0.002 SOL).
3. **Símbolos resueltos post-proceso via DexScreener batch** — Helius devuelve `tokenStandard: "Fungible"` en vez del símbolo real.
4. **`/kol` con 1 CA no filtra dust** — Con 1 solo token el filtro 0.005% vaciaba los resultados.
5. **Health check Helius al arrancar** — `index.ts` llama `getSlot` al inicio y loggea si la API key está quemada.
6. **Deps limpios**: `helius-sdk` y `better-sqlite3` eliminados — no se usan (todo es fetch directo).

## Gotchas conocidos
- **Helius free tier: 1M créditos/mes** — se agota. Cada `/wallet` consume ~300 créditos. El bot loggea `⚠️ max usage reached` si se agota.
- **Una sola instancia**: grammY da error 409 si hay dos instancias corriendo. Matar con `Get-Process node | Stop-Process -Force` antes de reiniciar.
- **tsx watch no recarga `.env`** — cambiar API key requiere matar y relanzar el proceso.
- **pump.fun endpoints** pueden cambiar — `pumpfun.ts` tiene multi-endpoint fallback.

## APIs y créditos estimados
| Comando | Créditos Helius aprox. |
|---|---|
| `/kol` (1 CA, 5000 holders) | ~5-10 |
| `/top20` | ~25 (1 DAS por holder) |
| `/top50` | ~55 |
| `/wallet` | ~300 (SWAP+TRANSFER+LP x100 txs) |
| `/fresh` / `/funded` | ~50-60 |
| `/bundle` | ~5 |

## Variables de Entorno (.env)
Ver `.env.example`:
```
TELEGRAM_BOT_TOKEN=
HELIUS_API_KEY=
BIRDEYE_API_KEY=    # futuro
```

## Setup
```
npm install
npm run build
npm run dev   # tsx watch — recarga en cambios .ts
npm start     # node dist/index.js — producción
```
