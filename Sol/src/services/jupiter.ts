import { TokenPrice } from "../types";
import { cacheGet, cacheSet } from "../utils/cache";
import { config } from "../config";

const JUPITER_PRICE_API = "https://api.jup.ag/price/v2";

/**
 * Get USD prices for multiple token mints using Jupiter Price API.
 * Free, no API key required.
 */
export async function getTokenPrices(mints: string[]): Promise<Map<string, number>> {
  if (mints.length === 0) return new Map();

  // Check cache first
  const prices = new Map<string, number>();
  const uncached: string[] = [];

  for (const mint of mints) {
    const cached = cacheGet<number>(`price:${mint}`);
    if (cached !== null) {
      prices.set(mint, cached);
    } else {
      uncached.push(mint);
    }
  }

  if (uncached.length === 0) return prices;

  // Jupiter allows up to 100 ids per request
  const chunks: string[][] = [];
  for (let i = 0; i < uncached.length; i += 100) {
    chunks.push(uncached.slice(i, i + 100));
  }

  for (const chunk of chunks) {
    try {
      const url = `${JUPITER_PRICE_API}?ids=${chunk.join(",")}`;
      const res = await fetch(url);
      const json = (await res.json()) as any;

      if (json.data) {
        for (const [mint, info] of Object.entries(json.data) as [string, any][]) {
          const price = parseFloat(info.price) || 0;
          prices.set(mint, price);
          cacheSet(`price:${mint}`, price, config.cacheTtl);
        }
      }
    } catch (err) {
      console.error("Jupiter price fetch error:", err);
    }
  }

  return prices;
}
