// Bulk-harvest de labels Arkham — pide /counterparties/entity/{id} para entidades
// conocidas y persiste todas las addresses devueltas en learned_labels.json.
//
// Uso: cd Sol && npx tsx scripts/harvest_labels.ts
//
// Hay que correrlo ANTES de que expire la key Arkham. Acumula gratis labels
// que sobreviven sin la key.

import "dotenv/config";
import { persistLearnedLabel, getDataDir } from "../src/services/funder_lists";

const API_KEY = process.env.ARKHAM_API_KEY || "";
if (!API_KEY) {
  console.error("ARKHAM_API_KEY no configurada. Aborto.");
  process.exit(1);
}

// Entidades principales a harvestar. Cada una devuelve hasta 50 counterparties
// por chain. La lista cubre los CEX/bridges más relevantes.
const ENTITIES = [
  // CEX top
  "binance", "coinbase", "kraken", "okx", "kucoin", "bitfinex", "gate-io",
  "mexc", "bitget", "bybit", "huobi", "htx", "bitstamp", "gemini", "crypto-com",
  "bingx", "upbit", "bithumb", "wazirx", "woo-x", "deribit", "bittrex",
  // Bridges/Aggs
  "stargate", "synapse", "across", "hop-protocol", "layerzero", "celer",
  "debridge", "orbiter-finance", "squid-router", "allbridge", "connext",
  // Mixers
  "tornado-cash", "railgun",
  // Instant swap
  "changenow", "fixedfloat", "simpleswap", "sideshift", "stealthex",
  "exolix", "godex", "trocador",
  // Gambling
  "stake-com", "rollbit", "bc-game", "shuffle",
];

const ARKHAM_CHAIN_MAP: Record<string, string> = {
  ethereum: "ethereum",
  bnb: "bsc",
};

function mapToFunderType(t?: string | null): string | null {
  if (!t) return null;
  const x = t.toLowerCase();
  if (x === "cex") return "CEX";
  if (x === "bridge") return "BRIDGE";
  if (x === "mixer" || x === "tornado") return "MIXER";
  if (x === "swap" || x === "service" || x === "swap-service" || x === "instant exchange") return "SWAP_SERVICE";
  if (x === "gambling") return "GAMBLING";
  if (x === "custodian") return "CUSTODIAN";
  if (x === "fund") return "FUND";
  if (x === "lending-centralized" || x === "lending") return "LENDING";
  if (x === "blockchain-infra" || x === "infra") return "INFRA";
  if (x === "dex") return "DEX";
  if (x === "dex-aggregator") return "DEX_AGG";
  if (x === "mev" || x === "mev-bot") return "MEV";
  if (x === "individual" || x === "kol") return "KOL";
  if (x === "market-maker" || x === "market_maker") return "MARKET_MAKER";
  return null;
}

async function harvestEntity(id: string): Promise<number> {
  // Sin chain → todas las chains
  const url = `https://api.arkm.com/counterparties/entity/${id.toLowerCase()}?limit=50`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { "API-Key": API_KEY, accept: "application/json" },
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    console.warn(`  ✗ ${id}: fetch failed (${(e as Error).message})`);
    return 0;
  }
  if (!res.ok) {
    console.warn(`  ✗ ${id}: HTTP ${res.status}`);
    return 0;
  }
  const json = (await res.json()) as Record<string, any[]>;
  let added = 0;
  for (const [arkhamChain, list] of Object.entries(json)) {
    const ourChain = ARKHAM_CHAIN_MAP[arkhamChain];
    if (!ourChain) continue;
    if (!Array.isArray(list)) continue;
    for (const cp of list) {
      const a = cp?.address;
      if (!a?.address) continue;
      if (!/^0x[a-fA-F0-9]{40}$/.test(a.address)) continue;
      const ent = a.arkhamEntity;
      const lbl = a.arkhamLabel;
      if (!ent && !lbl) continue;
      const funderType = mapToFunderType(ent?.type);
      persistLearnedLabel({
        address: a.address.toLowerCase(),
        chain: ourChain === "eth" ? "ethereum" : ourChain,
        funderType,
        entityName: ent?.name ?? null,
        labelName: lbl?.name ?? null,
      });
      added++;
    }
  }
  return added;
}

(async () => {
  console.log(`Harvesting Arkham labels → ${getDataDir()}/learned_labels.json`);
  let total = 0;
  for (const id of ENTITIES) {
    const n = await harvestEntity(id);
    if (n > 0) console.log(`  ✓ ${id}: +${n} labels`);
    total += n;
    // Throttle: 1 req/s para no quemar rate limit
    await new Promise((r) => setTimeout(r, 1100));
  }
  console.log(`\nTotal: ${total} labels harvested.`);
})();
