import { cacheGet, cacheSet } from "../utils/cache";
import { config } from "../config";
import { HeatmapCoin } from "../types";

let lastCoinGeckoCall = 0;

async function geckoThrottle(): Promise<void> {
  const minInterval = 1000; // 1 second between calls
  const elapsed = Date.now() - lastCoinGeckoCall;
  if (elapsed < minInterval) {
    await new Promise((r) => setTimeout(r, minInterval - elapsed));
  }
  lastCoinGeckoCall = Date.now();
}

export async function getTopCoinsHeatmap(limit: number = 30): Promise<HeatmapCoin[]> {
  const cacheKey = `coingecko:heatmap:${limit}`;
  const cached = cacheGet<HeatmapCoin[]>(cacheKey);
  if (cached) return cached;

  await geckoThrottle();

  const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=1&sparkline=false&price_change_percentage=24h`;
  const res = await fetch(url);
  const json = (await res.json()) as any;

  if (!Array.isArray(json)) return [];

  const result: HeatmapCoin[] = json.map((coin: any) => ({
    id: coin.id,
    symbol: coin.symbol,
    name: coin.name,
    currentPrice: coin.current_price || 0,
    priceChangePercentage24h: coin.price_change_percentage_24h || 0,
    marketCap: coin.market_cap || 0,
  }));

  cacheSet(cacheKey, result, 5 * 60 * 1000); // 5 minute cache
  return result;
}
