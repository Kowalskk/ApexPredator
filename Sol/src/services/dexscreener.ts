import { cacheGet, cacheSet } from "../utils/cache";
import { config } from "../config";

export interface DexScreenerToken {
  name: string;
  symbol: string;
  priceUsd: number;
  marketCap: number;
  volume24h: number;
  liquidity: number;
  pairCreatedAt: number;
  iconUrl: string | null;
  website: string | null;
  twitter: string | null;
  dexId: string;
  pairAddress: string;
  mint: string;
}

export async function getTokenInfo(mint: string): Promise<DexScreenerToken | null> {
  const cacheKey = `dex:info:${mint}`;
  const cached = cacheGet<DexScreenerToken>(cacheKey);
  if (cached) return cached;

  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
  const json = (await res.json()) as any;

  const pairs: any[] = json.pairs || [];
  if (pairs.length === 0) return null;

  // Pick the pair with highest liquidity
  const pair = pairs.sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];

  const result: DexScreenerToken = {
    mint,
    name: pair.baseToken?.name || "Unknown",
    symbol: pair.baseToken?.symbol || "???",
    priceUsd: parseFloat(pair.priceUsd || "0"),
    marketCap: pair.marketCap || pair.fdv || 0,
    volume24h: pair.volume?.h24 || 0,
    liquidity: pair.liquidity?.usd || 0,
    pairCreatedAt: pair.pairCreatedAt || 0,
    iconUrl: pair.info?.imageUrl || null,
    website: pair.info?.websites?.[0]?.url || null,
    twitter: pair.info?.socials?.find((s: any) => s.type === "twitter")?.url || null,
    dexId: pair.dexId || "unknown",
    pairAddress: pair.pairAddress || "",
  };

  cacheSet(cacheKey, result, config.cacheTtl);
  return result;
}

export async function getTokenMetadata(mint: string): Promise<string | null> {
  const cacheKey = `dex:meta:${mint}`;
  const cached = cacheGet<string | null>(cacheKey);
  if (cached !== null) return cached;

  const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${mint}`);
  const json = (await res.json()) as any;

  const pairs: any[] = json.pairs || [];
  if (pairs.length === 0) {
    cacheSet(cacheKey, null, config.cacheTtl);
    return null;
  }

  const pair = pairs.sort((a: any, b: any) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
  const imageUrl: string | null = pair.info?.imageUrl || null;

  cacheSet(cacheKey, imageUrl, config.cacheTtl);
  return imageUrl;
}
