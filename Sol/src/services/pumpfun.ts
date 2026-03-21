import { cacheGet, cacheSet } from "../utils/cache";
import { config } from "../config";
import { GraduatedToken, EarlyBuyer } from "../types";

const HEADERS = {
  "Accept": "application/json",
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
};

// Try multiple known pump.fun API endpoints
const PUMPFUN_ENDPOINTS = [
  "https://frontend-api.pump.fun",
  "https://client-api-2-74b1891ee9f9.herokuapp.com",
];

async function pumpfunFetch(path: string): Promise<any | null> {
  for (const base of PUMPFUN_ENDPOINTS) {
    try {
      const res = await fetch(`${base}${path}`, { headers: HEADERS });
      if (res.ok) {
        const json = await res.json();
        return json;
      }
    } catch {
      // try next endpoint
    }
  }
  return null;
}

export async function getRecentGraduated(limit: number = 10): Promise<GraduatedToken[]> {
  const cacheKey = `pumpfun:graduated:${limit}`;
  const cached = cacheGet<GraduatedToken[]>(cacheKey);
  if (cached) return cached;

  const json = await pumpfunFetch(
    `/coins?offset=0&limit=${limit}&sort=last_trade_timestamp&order=DESC&includeNsfw=false&complete=true`
  );

  const coins: any[] = Array.isArray(json) ? json : [];

  const result: GraduatedToken[] = coins.map((c: any) => ({
    mint: c.mint,
    name: c.name || "Unknown",
    symbol: c.symbol || "???",
    usdMarketCap: c.usd_market_cap || 0,
    createdTimestamp: c.created_timestamp || 0,
  }));

  cacheSet(cacheKey, result, 60 * 1000); // 1 min cache
  return result;
}

export async function getTokenEarlyBuyers(mint: string): Promise<EarlyBuyer[]> {
  const cacheKey = `pumpfun:earlybuyers:${mint}`;
  const cached = cacheGet<EarlyBuyer[]>(cacheKey);
  if (cached) return cached;

  const json = await pumpfunFetch(
    `/trades/all/${mint}?offset=0&limit=200&minimumSize=0`
  );

  if (!Array.isArray(json) || json.length === 0) return [];

  // Sort by timestamp ascending (oldest = earliest buyers first)
  const sorted = [...json].sort((a: any, b: any) => {
    const ta = Number(a.timestamp) || 0;
    const tb = Number(b.timestamp) || 0;
    return ta - tb;
  });

  const buyers: EarlyBuyer[] = sorted
    .filter((t: any) => t.is_buy === true)
    .map((t: any) => {
      // sol_amount can be in lamports or already in SOL depending on API version
      const rawSol = Number(t.sol_amount) || 0;
      const solAmount = rawSol > 1000 ? rawSol / 1e9 : rawSol; // detect lamports vs SOL

      // timestamp: pump.fun returns Unix seconds
      const ts = Number(t.timestamp) || 0;

      return {
        wallet: t.user || t.trader_public_key || t.wallet || "unknown",
        solAmount,
        tokenAmount: Number(t.token_amount) || 0,
        timestamp: ts,
      };
    });

  cacheSet(cacheKey, buyers, config.cacheTtl);
  return buyers;
}

export async function getTokenInfoFromPumpfun(mint: string): Promise<any | null> {
  const cacheKey = `pumpfun:coin:${mint}`;
  const cached = cacheGet<any>(cacheKey);
  if (cached) return cached;

  const json = await pumpfunFetch(`/coins/${mint}`);
  if (!json || !json.mint) return null;

  cacheSet(cacheKey, json, config.cacheTtl);
  return json;
}
