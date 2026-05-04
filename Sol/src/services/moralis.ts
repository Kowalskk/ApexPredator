import { cacheGet, cacheSet } from "../utils/cache";
import { config } from "../config";

const BASE_URL = "https://deep-index.moralis.io/api/v2.2";

function headers(): Record<string, string> {
  return {
    "X-API-Key": config.moralisApiKey!,
    "Content-Type": "application/json",
  };
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EvmSwap {
  transactionHash: string;
  blockTimestamp: string;   // ISO string
  tokenIn: { address: string; symbol: string; amount: number };
  tokenOut: { address: string; symbol: string; amount: number };
  amountUsd: number;
}

export interface EvmTransfer {
  transactionHash: string;
  blockTimestamp: string;
  tokenAddress: string;
  symbol: string;
  amount: number;
  toAddress: string;
  fromAddress: string;
  valueUsd: number;
}

export interface EvmTokenBalance {
  tokenAddress: string;
  symbol: string;
  name: string;
  decimals: number;
  balance: number;       // human-readable
  usdValue: number;
  percentageRelativeToTotalSupply: number;
}

export interface EvmTopHolder {
  ownerAddress: string;
  balance: number;
  usdValue: number;
  percentageRelativeToTotalSupply: number;
}

// ─── Wallet swaps (swap history) ─────────────────────────────────────────────

export async function getEvmWalletSwaps(
  address: string,
  chain: string = "eth",
  limit = 100
): Promise<EvmSwap[]> {
  const cacheKey = `moralis:swaps:${chain}:${address}`;
  const cached = cacheGet<EvmSwap[]>(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/wallets/${address}/swaps?chain=${chain}&limit=${limit}&order=DESC`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`Moralis swaps error: ${res.status}`);
  const json = (await res.json()) as any;

  const result: EvmSwap[] = (json.result || []).map((s: any) => ({
    transactionHash: s.transactionHash,
    blockTimestamp: s.blockTimestamp,
    tokenIn: {
      address: s.tokenIn?.address || "",
      symbol: s.tokenIn?.symbol || "???",
      amount: parseFloat(s.tokenIn?.amount || "0"),
    },
    tokenOut: {
      address: s.tokenOut?.address || "",
      symbol: s.tokenOut?.symbol || "???",
      amount: parseFloat(s.tokenOut?.amount || "0"),
    },
    amountUsd: Number(s.totalValueUsd ?? s.amountUsd ?? 0) || 0,
  }));

  cacheSet(cacheKey, result, config.cacheTtl);
  return result;
}

// ─── Wallet token transfers (outgoing) ────────────────────────────────────────

export async function getEvmWalletTransfers(
  address: string,
  chain: string = "eth",
  limit = 50
): Promise<EvmTransfer[]> {
  const cacheKey = `moralis:transfers:${chain}:${address}`;
  const cached = cacheGet<EvmTransfer[]>(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/${address}/erc20/transfers?chain=${chain}&limit=${limit}&order=DESC`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`Moralis transfers error: ${res.status}`);
  const json = (await res.json()) as any;

  const result: EvmTransfer[] = (json.result || [])
    .filter((t: any) => t.fromAddress?.toLowerCase() === address.toLowerCase())
    .map((t: any) => {
      const decimals = parseInt(t.tokenDecimals || "18");
      const raw = BigInt(t.value || "0");
      const amount = Number(raw) / 10 ** decimals;
      return {
        transactionHash: t.transactionHash,
        blockTimestamp: t.blockTimestamp,
        tokenAddress: t.address,
        symbol: t.tokenSymbol || "???",
        amount,
        toAddress: t.toAddress,
        fromAddress: t.fromAddress,
        valueUsd: Number(t.valueWithUsd?.usdValue ?? t.usdValue ?? 0) || 0,
      };
    });

  cacheSet(cacheKey, result, config.cacheTtl);
  return result;
}

// ─── Wallet net worth / token balances ────────────────────────────────────────

export async function getEvmWalletTokens(
  address: string,
  chain: string = "eth"
): Promise<EvmTokenBalance[]> {
  const cacheKey = `moralis:tokens:${chain}:${address}`;
  const cached = cacheGet<EvmTokenBalance[]>(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/wallets/${address}/tokens?chain=${chain}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`Moralis tokens error: ${res.status}`);
  const json = (await res.json()) as any;

  const result: EvmTokenBalance[] = (json.result || []).map((t: any) => {
    const decimals = parseInt(t.decimals || "18");
    const raw = BigInt(t.balance || "0");
    const balance = Number(raw) / 10 ** decimals;
    return {
      tokenAddress: t.tokenAddress || t.token_address || "",
      symbol: t.symbol || "???",
      name: t.name || "Unknown",
      decimals,
      balance,
      usdValue: Number(t.usdValue ?? t.usd_value ?? 0) || 0,
      percentageRelativeToTotalSupply: Number(t.percentageRelativeToTotalSupply ?? t.percentage_relative_to_total_supply ?? 0) || 0,
    };
  });

  cacheSet(cacheKey, result, config.cacheTtl);
  return result;
}

// ─── Token top holders ────────────────────────────────────────────────────────

export async function getEvmTopHolders(
  tokenAddress: string,
  chain: string = "eth",
  limit = 20
): Promise<EvmTopHolder[]> {
  const cacheKey = `moralis:holders:${chain}:${tokenAddress}:${limit}`;
  const cached = cacheGet<EvmTopHolder[]>(cacheKey);
  if (cached) return cached;

  const url = `${BASE_URL}/erc20/${tokenAddress}/owners?chain=${chain}&limit=${limit}&order=DESC`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) throw new Error(`Moralis holders error: ${res.status}`);
  const json = (await res.json()) as any;

  const result: EvmTopHolder[] = (json.result || []).map((h: any) => {
    const decimals = parseInt(h.decimals || "18");
    const raw = BigInt(h.balance || "0");
    const balance = Number(raw) / 10 ** decimals;
    return {
      ownerAddress: h.ownerAddress || h.owner_address || h.address || "",
      balance,
      usdValue: Number(h.usdValue ?? h.usd_value ?? 0) || 0,
      percentageRelativeToTotalSupply: Number(h.percentageRelativeToTotalSupply ?? h.percentage_relative_to_total_supply ?? 0) || 0,
    };
  });

  cacheSet(cacheKey, result, config.cacheTtl);
  return result;
}

// ─── Wallet first tx (age detection) ──────────────────────────────────────────

export async function getEvmWalletAge(
  address: string,
  chain: string = "eth"
): Promise<{ firstTxTimestamp: number; txCount: number }> {
  const cacheKey = `moralis:age:${chain}:${address}`;
  const cached = cacheGet<{ firstTxTimestamp: number; txCount: number }>(cacheKey);
  if (cached) return cached;

  // Get oldest transaction (order ASC, limit 1)
  const url = `${BASE_URL}/${address}?chain=${chain}`;
  const res = await fetch(url, { headers: headers() });
  if (!res.ok) return { firstTxTimestamp: 0, txCount: 0 };
  const json = (await res.json()) as any;

  const result = {
    firstTxTimestamp: json.firstTransaction?.blockTimestamp
      ? Math.floor(new Date(json.firstTransaction.blockTimestamp).getTime() / 1000)
      : 0,
    txCount: json.transactionCount || 0,
  };

  cacheSet(cacheKey, result, config.cacheTtl);
  return result;
}
