# ApexPredator_sol - Telegram Bot para Solana On-Chain Analytics

## Descripción
Bot de Telegram que proporciona utilidades de análisis on-chain en Solana. Se construye de forma incremental, añadiendo utilidades una a una.

## Stack Tecnológico
- **Runtime**: Node.js 20+ con TypeScript
- **Bot Framework**: grammY (moderno, TypeScript-first, mejor que node-telegram-bot-api)
- **API Principal**: Helius (free tier: 1M credits/mes, 10 RPS)
- **API Secundaria**: Birdeye (cuando necesitemos precios USD nativos)
- **Precios**: Jupiter Price API (gratuito) como fuente principal de precios USD
- **Base de datos**: SQLite via better-sqlite3 (ligero, sin servidor externo)

## Arquitectura
```
src/
├── index.ts              # Entry point, inicializa bot
├── bot.ts                # Configuración del bot de Telegram
├── config.ts             # Variables de entorno y configuración
├── commands/             # Handlers de comandos
│   ├── kol.ts            # /kol - Buscar wallets que tradearon N tokens
│   ├── top20.ts          # /top20 - Top 20 holders + portfolio
│   └── top50.ts          # /top50 - Top 50 holders + portfolio
├── services/             # Lógica de negocio
│   ├── helius.ts         # Cliente Helius API
│   ├── jupiter.ts        # Jupiter Price API para USD values
│   └── birdeye.ts        # Cliente Birdeye (futuro)
├── utils/                # Utilidades
│   ├── format.ts         # Formateo de mensajes para Telegram
│   ├── solana.ts         # Validación de direcciones Solana
│   └── cache.ts          # Cache simple en memoria con TTL
└── types/                # TypeScript types
    └── index.ts          # Interfaces y tipos compartidos
```

## Comandos

### Implementados ✅
- [x] `/kol <ca1> <ca2> [ca3]` - Encuentra wallets que tradearon TODOS los tokens (máx 3)
- [x] `/top20 <ca>` - Top 20 holders + holdings >$5
- [x] `/top50 <ca>` - Top 50 holders + holdings >$5

### Roadmap (inspirado en Mugetsu, ver KNOWLEDGE_BASE.md)
**Fase 2 - Wallet Intelligence:**
- [ ] `/wallet <address>` - Análisis PnL de las últimas 300 tx de una wallet
- [ ] `/fresh <ca>` - Detectar wallets nuevas (< 20 tx) entre los holders
- [ ] `/funded <ca>` - Analizar origen de fondeo de wallets holders (detectar coordinación)

**Fase 3 - Scam Detection:**
- [ ] `/bundle <ca>` - Detectar si el token fue bundled al deploy (mismas wallets, mismo slot)
- [ ] `/early <ca>` - Early buyers de pump.fun (snipers/insiders)
- [ ] `/dex <ca>` - Verificar si el token tiene info actualizada en DEXScreener

**Fase 4 - Social/Web OSINT:**
- [ ] `/twitter <handle>` - Historial de cambios de nombre de una cuenta de Twitter/X
- [ ] `/site <url>` - Buscar webs duplicadas/template reuse (detección de rugs)
- [ ] `/img <ca>` - Reverse image search del token image via Google Lens

**Fase 5 - Market Overview:**
- [ ] `/hmap` - Heatmap de rendimiento diario de las top cryptos
- [ ] `/graduated` - Últimos 10 tokens graduados de pump.fun + ATH mcap
- [ ] `/hscan <ca>` - Evolución del número de holders en el tiempo

## APIs y Endpoints Clave

### Helius (Free Tier)
- `getTokenAccounts` - Obtener holders de un token por mint address (paginado, 1000/página)
- `getAssetsByOwner` (DAS API) - Portfolio de una wallet (2 RPS en free tier)
- Rate limit: 10 RPS general, 2 RPS para DAS API

### Jupiter Price API (Gratuito)
- `GET https://api.jup.ag/price/v2?ids=<mint1>,<mint2>,...` - Precios en USD
- Sin API key, rate limits generosos

## Decisiones de Diseño
1. **Helius sobre Birdeye/Nansen**: Free tier viable (1M credits, 10 RPS). Birdeye free tier es 30K CUs + 1 RPS. Nansen da 100 créditos one-time.
2. **grammY sobre node-telegram-bot-api**: Mejor tipado, middleware system, más mantenido.
3. **Jupiter para precios**: Gratuito, sin API key, datos de DEX en tiempo real.
4. **Cache en memoria**: Evitar llamadas repetidas a APIs, TTL de 5 min.

## Convenciones
- Mensajes del bot en inglés (estándar crypto)
- Usar MarkdownV2 para formatear respuestas en Telegram
- Manejar errores con mensajes claros al usuario
- Respetar rate limits con delays entre llamadas
- No enviar más de 4096 caracteres por mensaje (límite Telegram), paginar si es necesario

## Referencia
- **Competencia**: Mugetsu bot (@the_mugetsu_bot) - 1 SOL/mes, 15 comandos, SOL+ETH
- **Diferenciación**: ApexPredator es gratuito, umbral bajo ($5 vs $25K), solo Solana
- **Knowledge Base**: Ver KNOWLEDGE_BASE.md para errores resueltos y notas técnicas

## Variables de Entorno (.env)
```
TELEGRAM_BOT_TOKEN=
HELIUS_API_KEY=
BIRDEYE_API_KEY=    # futuro
```
