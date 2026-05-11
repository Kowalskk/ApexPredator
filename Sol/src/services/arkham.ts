import { cacheGet, cacheSet } from "../utils/cache";
import { config } from "../config";

// Cliente Arkham Intelligence — versión simplificada (cache memoria, sin DB).
// Adaptado de Documents/fresh/src/classify/arkham.ts
// Free trial: 10k unique lookups/mes, 20 req/s.

const ARKHAM_CHAIN: Record<string, string> = {
  eth: "ethereum",
  bsc: "bnb",
  base: "base",
  arbitrum: "arbitrum",
};

export interface ArkhamLabel {
  /** CEX | BRIDGE | MIXER | SWAP_SERVICE | GAMBLING | CUSTODIAN | FUND | LENDING | INFRA | DEX | DEX_AGG | MEV | KOL | MARKET_MAKER | null */
  funderType: string | null;
  /** "Binance · Hot Wallet" o null */
  label: string | null;
  entityId: string | null;
  entityName: string | null;
  entityType: string | null;
}

function mapToFunderType(arkhamType: string | null | undefined): string | null {
  if (!arkhamType) return null;
  const t = arkhamType.toLowerCase();
  if (t === "cex") return "CEX";
  if (t === "bridge") return "BRIDGE";
  if (t === "mixer" || t === "tornado") return "MIXER";
  if (t === "swap" || t === "service" || t === "instant exchange" || t === "swap-service") return "SWAP_SERVICE";
  if (t === "gambling") return "GAMBLING";
  if (t === "custodian") return "CUSTODIAN";
  if (t === "fund") return "FUND";
  if (t === "lending-centralized" || t === "lending") return "LENDING";
  if (t === "blockchain-infra" || t === "infra") return "INFRA";
  if (t === "dex") return "DEX";
  if (t === "dex-aggregator") return "DEX_AGG";
  if (t === "mev" || t === "mev-bot") return "MEV";
  if (t === "individual" || t === "kol") return "KOL";
  if (t === "market-maker" || t === "market_maker") return "MARKET_MAKER";
  return null;
}

const SWAP_SERVICE_RE = /(changenow|fixedfloat|simpleswap|sideshift|stealthex|exolix|godex|letsexchange|trocador|majesticbank|swapuz|exch\.cx|alfacash|nanswap|easybit|switchain|crypstation|exchfx|orangefren|swapter|crosschain)/i;
const CEX_LABEL_RE = /(binance|coinbase|kraken|okx|kucoin|bitfinex|gate\.io|mexc|huobi|htx|bybit|bitstamp|gemini|crypto\.com|bingx|bitget|upbit|bithumb|coinone|korbit|wazirx|woo network|woo x|deribit|bittrex)/i;
const GAMBLING_RE = /(stake\.com|stake\.bet|rollbit|bc\.game|bcgame|cloudbet|trustdice|moonroll|sportsbet|primedice|metawin|shuffle)/i;
const BRIDGE_RE = /(stargate|wormhole|synapse|across|hop protocol|layerzero|celer|debridge|orbiter|squid|allbridge|connext|cbridge|mayan)/i;
const MIXER_RE = /(tornado|railgun|wasabi|samourai|sinbad|blender)/i;

function inferFromLabel(labelName: string | null, entityName: string | null): string | null {
  const blob = `${entityName ?? ""} ${labelName ?? ""}`.trim();
  if (!blob) return null;
  if (SWAP_SERVICE_RE.test(blob)) return "SWAP_SERVICE";
  if (CEX_LABEL_RE.test(blob)) return "CEX";
  if (GAMBLING_RE.test(blob)) return "GAMBLING";
  if (BRIDGE_RE.test(blob)) return "BRIDGE";
  if (MIXER_RE.test(blob)) return "MIXER";
  return null;
}

export async function resolveArkhamLabel(address: string, chain: string): Promise<ArkhamLabel | null> {
  if (!config.arkhamApiKey) return null;
  const key = `arkham:${chain}:${address.toLowerCase()}`;
  const cached = cacheGet<ArkhamLabel | null>(key);
  if (cached !== undefined) return cached;

  try {
    const url = `https://api.arkm.com/intelligence/address/${address.toLowerCase()}`;
    const res = await fetch(url, {
      headers: { "API-Key": config.arkhamApiKey, accept: "application/json" },
      signal: AbortSignal.timeout(8_000),
    });
    if (res.status === 404 || !res.ok) {
      cacheSet(key, null, 60 * 60 * 1000);
      return null;
    }
    const json = (await res.json()) as any;
    const expectedChain = ARKHAM_CHAIN[chain];
    if (!json.chain || (expectedChain && json.chain !== expectedChain)) {
      cacheSet(key, null, 30 * 60 * 1000);
      return null;
    }
    const entityType = json.arkhamEntity?.type ?? null;
    const entityName = json.arkhamEntity?.name ?? null;
    const labelName = json.arkhamLabel?.name ?? null;
    const entityId = json.arkhamEntity?.id ?? null;
    const funderType = mapToFunderType(entityType) ?? inferFromLabel(labelName, entityName);

    const result: ArkhamLabel = {
      funderType,
      label: entityName ? `${entityName}${labelName ? ` · ${labelName}` : ""}` : labelName,
      entityId,
      entityName,
      entityType,
    };
    cacheSet(key, result, 60 * 60 * 1000);
    return result;
  } catch {
    cacheSet(key, null, 60 * 1000);
    return null;
  }
}
