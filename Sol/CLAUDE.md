# ApexPredator — Telegram Bot Multi-Chain de Analytics On-Chain

## Descripción

Bot de Telegram de analytics on-chain para **Solana + EVM (Ethereum, BSC, Base, Arbitrum)**. Uso propio. Inspirado en Mugetsu pero gratuito y unificado: un mismo `/wallet`, `/top20`, `/kol` funciona en cualquier chain — el bot detecta automáticamente el formato de dirección (`base58` → Solana, `0x...` → EVM) y enruta a la chain correspondiente.

Carpeta del proyecto: `Sol/` (nombre histórico — ya no es solo Sol).

## Stack Tecnológico

- **Runtime**: Node.js 20+ con TypeScript estricto
- **Bot Framework**: grammY (HTML parse mode preferido sobre MarkdownV2)
- **APIs Solana**:
  - **Helius** (free tier: 1M créditos/mes, 10 RPS general / 2 RPS DAS) — RPC + Enhanced Transactions API
  - **Jupiter Price API** (gratis, sin key) — precios batch hasta 100 mints
  - **pump.fun frontend-api** — early buyers, graduated tokens (frágil, multi-endpoint fallback)
- **APIs EVM**:
  - **Moralis** (free tier: 40K CU/día) — swaps de wallet, transfers, top holders, balances
  - DexScreener — auto-detección de chain por contrato (lookup del par con más liquidez)
- **APIs cross-chain**:
  - **DexScreener** (gratis) — info de tokens, símbolos, precios, también detecta chain
  - **CoinGecko** (gratis, throttle 1 RPS) — precios nativos (ETH, BNB), heatmap
  - **quickchart.io** (gratis) — render del heatmap como PNG

## Arquitectura

```
Sol/
├── src/
│   ├── index.ts              # Entry — health check Helius + arranca bot
│   ├── bot.ts                # Registro de comandos, /start /help en HTML
│   ├── config.ts             # Variables de entorno (Helius, Moralis, Telegram)
│   │
│   ├── commands/             # Handlers — los unificados enrutan por chain
│   │   ├── wallet.ts         # 🔀 Solana → helius_extended | EVM → evm_wallet
│   │   ├── topholders.ts     # 🔀 Solana → helius | EVM → evm_top
│   │   ├── kol.ts            # 🔀 Solana → helius | EVM → evm_kol
│   │   ├── top20.ts          # Wrapper de topholders con limit=20
│   │   ├── top50.ts          # Wrapper con limit=50
│   │   │
│   │   ├── evm_wallet.ts     # PnL EVM (Moralis swaps + transfers)
│   │   ├── evm_top.ts        # Top holders EVM + portfolio por holder
│   │   ├── evm_kol.ts        # Intersección holders + transfers history
│   │   │
│   │   ├── fresh.ts          # Solana — fresh wallets entre top 50
│   │   ├── funded.ts         # Solana — funders compartidos top 30
│   │   ├── bundle.ts         # Solana — bundle detection en launch
│   │   ├── snipers.ts        # Solana — clustering de cabales sniper
│   │   ├── early.ts          # Solana — pump.fun early buyers
│   │   ├── graduated.ts      # Solana — pump.fun graduates
│   │   ├── dex.ts            # Cross-chain — DexScreener
│   │   ├── hmap.ts           # CoinGecko heatmap PNG
│   │   ├── img.ts            # Google Lens reverse image
│   │   ├── hscan.ts          # holderscan.io
│   │   ├── twitter.ts        # Stub: link a memory.lol
│   │   └── site.ts           # Stub: link a sitelike.org
│   │
│   ├── services/
│   │   ├── helius.ts         # Solana — getTokenHolders, getTopHolders, getWalletAssets, findCommonHolders
│   │   ├── helius_extended.ts # Solana — getWalletPnl, checkWalletAge, getWalletFirstFunder, etc
│   │   ├── moralis.ts        # EVM — getEvmWalletSwaps, Transfers, Tokens, TopHolders, Buyers, Age
│   │   ├── evm_pnl.ts        # EVM — getEvmWalletPnl (PnL/winrate/trading style)
│   │   ├── dexscreener.ts    # Cross-chain — getTokenInfo, detectEvmChain
│   │   ├── jupiter.ts        # Solana — getTokenPrices batch
│   │   ├── coingecko.ts      # CoinGecko — getTopCoinsHeatmap, native prices
│   │   ├── pumpfun.ts        # pump.fun — getRecentGraduated, getTokenEarlyBuyers
│   │   ├── cabal.ts          # Solana — analyzeSniperCabal (clustering 5 capas)
│   │   ├── labels.ts         # Solana — classifyWallet (CEX, whale, fresh, degen)
│   │   └── birdeye.ts        # PLACEHOLDER no implementado
│   │
│   ├── utils/
│   │   ├── solana.ts         # isValidSolanaAddress, shortenAddress
│   │   ├── evm.ts            # isValidEvmAddress, detectChain, escHtml, EVM_CHAINS
│   │   ├── format.ts         # escMd, splitMessage, formatUsd, formatAmount
│   │   └── cache.ts          # TTL cache en memoria (5 min default)
│   │
│   └── types/index.ts        # TokenHolding, WalletPnlResult, EvmWalletPnlResult, SniperWallet, etc
│
├── dist/                     # Compilado (gitignored)
├── .env                      # TELEGRAM_BOT_TOKEN, HELIUS_API_KEY, MORALIS_API_KEY
├── .env.example              # Plantilla de .env
├── CLAUDE.md                 # Este fichero
├── KNOWLEDGE_BASE.md         # Errores resueltos + lecciones aprendidas
└── package.json              # Solo grammy + dotenv (sin SDKs pesados)
```

## Comandos — Estado real (2026-05-04)

### ✅ Funcionales en Solana + EVM (auto-detectado)

| Comando | Solana | EVM |
|---|---|---|
| `/wallet <address> [chain]` | PnL completo (swaps + LP + transfers, símbolos via DexScreener batch) | PnL EVM (Moralis swaps + transfers, símbolos del propio swap) |
| `/top20 <ca> [chain]` / `/top50` | Top holders + portfolio + emojis (whale/fresh/degen) | Top holders + portfolio (Moralis getEvmWalletTokens por holder) |
| `/kol <ca1> <ca2> [ca3]` | Intersección via Helius getTokenAccounts | Top 500 holders + últimas 1000 transfers por token (cubre holders activos + ex-holders) |

**Detección de chain en EVM**: si el usuario no especifica `eth/bsc/base/arbitrum`, el bot consulta DexScreener y elige la chain con más liquidez para ese contrato.

### ✅ Funcionales solo Solana

- `/fresh <ca>` — wallets con <20 tx o <30 días entre top 50
- `/funded <ca>` — funders compartidos entre top 30
- `/bundle <ca>` — pump.fun trades (ventana 2s) + Helius fallback
- `/snipers <ca1> <ca2> ... [ca5]` — clustering 5 capas: multi-token, mismo funder, mismo importe, mismo buy size, mismo timing gap
- `/early <ca>` — pump.fun frontend-api (frágil)
- `/graduated` — pump.fun frontend-api (frágil)

### ✅ Cross-chain genéricos

- `/dex <ca>` — DexScreener (Solana + EVM nativamente)
- `/hmap` — CoinGecko + quickchart.io PNG (fallback texto)
- `/img <ca>` — link Google Lens con la imagen del token

### 🟡 Frágil

- `/hscan <ca>` — holderscan.io (scraping no oficial, Solana)

### ❌ Stubs

- `/twitter <handle>` — link a memory.lol
- `/site <url>` — link a sitelike.org

## Decisiones de Diseño Clave

1. **Bot unificado, no separado** — un solo proceso, un solo token de Telegram. Los comandos detectan chain por formato de dirección. UX cero fricción: el usuario no necesita prefijos ni comandos diferentes.

2. **HTML parse mode en `/start` y `/help`** — MarkdownV2 rompe con `<ca>` sin escapar. HTML soporta `&lt;` `&gt;` y es más legible.

3. **SOL amount en swaps desde `tokenTransfers` con `mint === SOL_MINT`** — `nativeTransfers` solo contiene fees/rent (~0.002 SOL). El SOL real del swap está en `tokenTransfers` como wSOL.

4. **Símbolos Solana resueltos post-proceso via DexScreener batch** — Helius devuelve `tokenStandard: "Fungible"` en vez del símbolo. DexScreener acepta hasta 30 mints por llamada.

5. **`/kol` con 1 CA no filtra dust** — Con un solo token el filtro 0.005% vaciaba los resultados.

6. **`/kol` EVM combina holders + transfers** — Solo holders pierde gente que ya vendió. Solo transfers pierde holders antiguos. La unión cubre ambos.

7. **DexScreener auto-detecta chain en EVM** — En `/top20` y `/kol`, si no se especifica, se consulta DexScreener y se elige la chain con más liquidez. Eficiente porque DexScreener ya estaba en uso para otros comandos (cache hit común).

8. **Health check Helius al arrancar** — `index.ts` llama `getSlot` y loggea inmediatamente si la API key está quemada. Evita debugging fantasma.

9. **`Number()` en lugar de `parseFloat()` para campos Moralis** — Moralis devuelve `usdValue` como número JSON real, no string. `parseFloat(number)` da `NaN`.

10. **Auto-detect failover de chain hint** — `chainHint === "eth"` se interpreta como "no especificado" y dispara DexScreener detect. Si el usuario pone explícitamente otra chain, se respeta.

11. **Deps mínimos** — Solo `grammy` + `dotenv`. Todo lo demás es `fetch` directo. Sin `helius-sdk`, sin `better-sqlite3`, sin `ethers.js`. Reducidos para deployment más rápido y menos superficie de bugs.

12. **No persistencia** — Cache en memoria (TTL 5 min). El bot es stateless, escalable horizontalmente (cuando haga falta).

## Configuración

### Variables de Entorno (.env)

```env
TELEGRAM_BOT_TOKEN=     # @BotFather → 7737408580:AAHy...
HELIUS_API_KEY=         # https://dev.helius.xyz/
MORALIS_API_KEY=        # https://admin.moralis.io/api-keys (JWT, ~230 chars, empieza por eyJ)
BIRDEYE_API_KEY=        # Reservado para futuro
```

### Setup local

```bash
npm install
npm run dev   # tsx watch — recarga en cambios .ts
npm run build && npm start  # producción
```

## Despliegue VPS

**Vultr Frankfurt** — `95.179.243.31` — root / `4mZ=hCCo49xD3#DK`

- **Path**: `/opt/apexpredator/`
- **Servicio**: `systemctl (start|stop|restart|status) apexpredator`
- **Logs**: `journalctl -u apexpredator -f`
- **Pipeline**: `git pull && cd Sol && npm install && npm run build && systemctl restart apexpredator`

Conectar **siempre con paramiko** desde Python (no PowerShell, no usar contraseñas en CLI). Salida `journalctl` filtrar `grep -v wolf` para evitar `UnicodeEncodeError` por el emoji 🐺 en cp1252.

### Coexistencia en VPS

Otros servicios corriendo en el mismo VPS (no tocar): `gmgn-terminal` (PM2), `livo-sniper` (PM2), `pkguardian`, `prophet`, `polymarket-tracker`, `ogbot`. Total RAM usado ~1.9 GB / 3.8 GB, disco 19/28 GB.

## APIs y créditos estimados

### Helius (Solana — 1M créditos/mes free)

| Comando | Créditos aprox. |
|---|---|
| `/kol` (1 CA, 5000 holders) | 5–10 |
| `/top20` | 25 (1 DAS por holder) |
| `/top50` | 55 |
| `/wallet` Solana | 300 (SWAP+TRANSFER+LP × 100 txs) |
| `/fresh` `/funded` | 50–60 |
| `/bundle` | 5 |
| `/snipers` (5 CAs) | 200–500 (depende de fresh wallets) |

### Moralis (EVM — 40K CU/día free)

| Comando | CU aprox. |
|---|---|
| `/wallet` EVM | ~50 (swaps + transfers + tokens) |
| `/top20` EVM | ~60 (1 holders + 20 portfolios) |
| `/top50` EVM | ~110 |
| `/kol` EVM (2 CAs) | ~80 (10 transfer pages + holders × 2) |

Cache TTL 5 minutos reduce sustancialmente las llamadas en uso normal.

## Gotchas conocidos

- **Helius free tier 1M cred/mes** — `/wallet` consume ~300. El startup loggea `⚠️ max usage reached` si se agota.
- **Moralis 40K CU/día** — `/kol` con 3 CAs puede consumir 300+ CU. En tokens muy activos sube por paginación de transfers.
- **Una sola instancia de grammY** — error 409 si hay dos. Matar con `Get-Process node | Stop-Process -Force` (Win) o `pkill node` (Linux).
- **tsx watch no recarga `.env`** — cambiar API key requiere matar y relanzar.
- **pump.fun endpoints** — pueden cambiar. `pumpfun.ts` tiene multi-endpoint fallback.
- **Cloudflare bloquea Python en local** — User-Agent `python-urllib/x.x` rebota con 403 1010. Funciona desde Node.js. Para tests locales usar paramiko → VPS → Node.
- **`parseFloat(number)` = NaN** — Moralis devuelve numéricos como JSON numbers, no strings. Usar `Number()`.
- **Moralis snake_case vs camelCase** — Algunos endpoints devuelven `owner_address`, otros `ownerAddress`. Mappers usan fallback `h.ownerAddress || h.owner_address`.
- **`chainId` de DexScreener** — `ethereum`, no `eth`. El mapper en `dexscreener.ts > DS_CHAIN_MAP` traduce a los nombres que espera Moralis.

## Quick reference — formatos de comando

```text
/wallet <solana_addr>           → PnL Solana
/wallet <0x_addr>               → PnL ETH (default)
/wallet <0x_addr> bsc           → PnL BSC explícito
/wallet <0x_addr> base          → PnL Base
/wallet <0x_addr> arbitrum      → PnL Arbitrum

/top20 <solana_ca>              → Top 20 Solana
/top20 <0x_ca>                  → Auto-detecta chain por DexScreener
/top20 <0x_ca> bsc              → Forzar BSC

/kol <ca1> <ca2>                → Auto-detecta. Solana O EVM (no mezcla)
/kol <ca1> <ca2> <ca3>          → Hasta 3 (Solana) — N (EVM, sin límite duro pero ojo CU)
```
