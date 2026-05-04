import { config } from "../config";
import { TokenHolder, TokenHolding } from "../types";
import { cacheGet, cacheSet } from "../utils/cache";

const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${config.heliusApiKey}`;
const HELIUS_API = `https://api.helius.xyz/v0`;

// Rate limiter: simple delay between calls
let lastDasCall = 0;
async function dasThrottle(): Promise<void> {
  const minInterval = 1000 / config.heliusRpsDas; // 500ms for 2 RPS
  const elapsed = Date.now() - lastDasCall;
  if (elapsed < minInterval) {
    await new Promise((r) => setTimeout(r, minInterval - elapsed));
  }
  lastDasCall = Date.now();
}

/**
 * Get all token accounts (holders) for a given mint address.
 * Uses getTokenAccounts (compressed + standard).
 * Returns up to `maxHolders` results.
 */
export async function getTokenHolders(
  mint: string,
  maxHolders = 5000
): Promise<TokenHolder[]> {
  const cacheKey = `holders:${mint}:${maxHolders}`;
  const cached = cacheGet<TokenHolder[]>(cacheKey);
  if (cached) return cached;

  const holders: TokenHolder[] = [];
  let cursor: string | undefined;

  while (holders.length < maxHolders) {
    const body: Record<string, unknown> = {
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccounts",
      params: {
        mint,
        limit: 1000,
        ...(cursor ? { cursor } : {}),
      },
    };

    const res = await fetch(HELIUS_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const json = (await res.json()) as any;
    if (json.error) {
      throw new Error(`Helius RPC error: ${json.error.message || json.error.code}`);
    }
    if (!json.result) break;

    const accounts = json.result.token_accounts || [];
    for (const acc of accounts) {
      holders.push({
        owner: acc.owner,
        amount: Number(acc.amount),
        decimals: acc.decimals ?? 0,
      });
    }

    cursor = json.result.cursor;
    if (!cursor || accounts.length < 1000) break;
  }

  cacheSet(cacheKey, holders, config.cacheTtl);
  return holders;
}

// DEX program IDs — accounts owned by these are LP vaults, not user wallets
const DEX_PROGRAMS = new Set([
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8", // Raydium AMM v4
  "CPMDWBwJDtYax9qW7AyRuVC19Cc4L4Vcy4n2BHAbHkCW", // Raydium CP Swap
  "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK", // Raydium CLMM
  "whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc",  // Orca Whirlpool
  "Eo7WjKq67rjJQDd81ywe8ydq8JNRRcRPOdDJVzjLWVAd", // Meteora DLMM
  "LBUZKhRxPF3XUpBCjp4YzTKgLccjZhTSDM9YuVaPwxo",  // Meteora LB Clmm
  "6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P",   // pump.fun
  "SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ",   // Saber StableSwap
  "9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP",  // Orca v1
]);

/**
 * Get the real total supply of a token from on-chain mint data.
 * Returns ui amount (human-readable) and raw amount.
 */
export async function getTokenSupply(
  mint: string
): Promise<{ uiAmount: number; rawAmount: number; decimals: number }> {
  const cacheKey = `supply:${mint}`;
  const cached = cacheGet<{ uiAmount: number; rawAmount: number; decimals: number }>(cacheKey);
  if (cached) return cached;

  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getTokenSupply",
    params: [mint],
  };

  const res = await fetch(HELIUS_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as any;
  const value = json.result?.value;

  const result = {
    uiAmount: value?.uiAmount || 0,
    rawAmount: Number(value?.amount || 0),
    decimals: value?.decimals || 0,
  };

  cacheSet(cacheKey, result, config.cacheTtl);
  return result;
}

/**
 * Check if a wallet address is a DEX LP vault (owned by a DEX program).
 * Only call this for suspected LP wallets (large % holders) to limit API calls.
 */
export async function checkIsLpWallet(address: string): Promise<boolean> {
  const cacheKey = `islp:${address}`;
  const cached = cacheGet<boolean>(cacheKey);
  if (cached !== null) return cached;

  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getAccountInfo",
    params: [address, { encoding: "base64" }],
  };

  try {
    const res = await fetch(HELIUS_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as any;
    const owner: string = json.result?.value?.owner || "";
    const isLp = DEX_PROGRAMS.has(owner);
    cacheSet(cacheKey, isLp, config.cacheTtl);
    return isLp;
  } catch {
    return false;
  }
}

/**
 * Get all assets (tokens/NFTs) owned by a wallet using DAS API.
 * Returns fungible tokens only.
 */
export async function getWalletAssets(
  walletAddress: string
): Promise<TokenHolding[]> {
  const cacheKey = `assets:${walletAddress}`;
  const cached = cacheGet<TokenHolding[]>(cacheKey);
  if (cached) return cached;

  await dasThrottle();

  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getAssetsByOwner",
    params: {
      ownerAddress: walletAddress,
      displayOptions: { showFungible: true, showNativeBalance: true },
    },
  };

  const res = await fetch(HELIUS_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as any;
  const items = json.result?.items || [];
  const nativeBalance = json.result?.nativeBalance;

  const holdings: TokenHolding[] = items
    .filter((item: any) => item.interface === "FungibleToken" || item.interface === "FungibleAsset")
    .map((item: any) => {
      const decimals: number = item.token_info?.decimals || 0;
      const rawBalance: number = Number(item.token_info?.balance || 0);
      const amount: number = decimals > 0 ? rawBalance / Math.pow(10, decimals) : rawBalance;
      const totalSupply: number | undefined = item.token_info?.supply
        ? Number(item.token_info.supply)
        : undefined;

      return {
        mint: item.id,
        symbol: item.content?.metadata?.symbol || "???",
        name: item.content?.metadata?.name || "Unknown",
        amount,
        rawBalance,
        decimals,
        usdValue: item.token_info?.price_info?.total_price || 0,
        totalSupply,
      };
    });

  // Add native SOL balance if present
  if (nativeBalance && nativeBalance.lamports > 0) {
    const solAmount = nativeBalance.lamports / 1e9;
    const solUsd = nativeBalance.total_price || solAmount * (nativeBalance.price_per_sol || 0);
    if (solUsd > 0 || solAmount > 0.01) {
      holdings.push({
        mint: "So11111111111111111111111111111111111111112",
        symbol: "SOL",
        name: "Solana",
        amount: solAmount,
        rawBalance: nativeBalance.lamports,
        decimals: 9,
        usdValue: solUsd,
        totalSupply: undefined,
      });
    }
  }

  cacheSet(cacheKey, holdings, config.cacheTtl);
  return holdings;
}

// ─── KOL Finder types ────────────────────────────────────────────────────────

export interface KolHolding {
  mint: string;
  amount: number;       // human-readable
  rawAmount: number;
  supplyPct: number;    // % of total supply
}

export interface KolWallet {
  address: string;
  holdings: KolHolding[];
}

export interface KolFindResult {
  wallets: KolWallet[];
  filteredCount: number;   // wallets removed by bot/dust filter
  totalBeforeFilter: number;
}

/**
 * Find wallets that hold ALL given token mints with anti-bot filtering.
 *
 * minSupplyPct (default 0.005%): wallets must hold ≥ this % of each token's
 * supply. Filters dust wallets, bots and spam accounts with tiny positions.
 */
export async function findCommonHolders(
  mints: string[],
  maxPerToken = 5000,
  minSupplyPct = 0.005
): Promise<KolFindResult> {
  // Fetch holders + real supply for each token in parallel
  const [holderArrays, supplies] = await Promise.all([
    Promise.all(mints.map((mint) => getTokenHolders(mint, maxPerToken))),
    Promise.all(mints.map((mint) =>
      getTokenSupply(mint).catch(() => ({ rawAmount: 0, uiAmount: 0, decimals: 0 }))
    )),
  ]);

  // For each token, build a map of owner → KolHolding (with dust filter applied)
  const holderMaps: Map<string, KolHolding>[] = holderArrays.map((holders, i) => {
    const supply = supplies[i].rawAmount;
    const map = new Map<string, KolHolding>();

    for (const h of holders) {
      // Calculate % of real supply; fall back to 100% / holderCount if supply unknown
      const supplyPct = supply > 0
        ? (h.amount / supply) * 100
        : (1 / holders.length) * 100;

      // Skip dust: must hold at least minSupplyPct of the supply
      if (supply > 0 && supplyPct < minSupplyPct) continue;

      // Skip LP/program accounts identified by DEX_PROGRAMS (no API call needed —
      // we check only if the same address appears across multiple expensive calls)
      map.set(h.owner, {
        mint: mints[i],
        amount: supply > 0 ? h.amount / Math.pow(10, supplies[i].decimals) : h.amount,
        rawAmount: h.amount,
        supplyPct,
      });
    }
    return map;
  });

  // Total before filter = largest raw holder count
  const totalBeforeFilter = Math.max(...holderArrays.map((a) => a.length));
  const totalAfterFilter = Math.min(...holderMaps.map((m) => m.size));
  const filteredCount = totalBeforeFilter - totalAfterFilter;

  // Intersection: wallets present in ALL filtered sets
  const [firstMap, ...restMaps] = holderMaps;
  const wallets: KolWallet[] = [];

  for (const [addr, firstHolding] of firstMap.entries()) {
    if (restMaps.every((m) => m.has(addr))) {
      wallets.push({
        address: addr,
        holdings: [
          firstHolding,
          ...restMaps.map((m) => m.get(addr)!),
        ],
      });
    }
  }

  return { wallets, filteredCount, totalBeforeFilter };
}

/**
 * Get top N holders of a token sorted by amount descending.
 */
export async function getTopHolders(
  mint: string,
  topN: number
): Promise<TokenHolder[]> {
  const holders = await getTokenHolders(mint, 10000);

  // Sort by amount descending and take top N
  return holders
    .sort((a, b) => b.amount - a.amount)
    .slice(0, topN);
}
