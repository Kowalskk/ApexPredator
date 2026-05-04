import { getEvmWalletSwaps, getEvmWalletTransfers, getEvmWalletTokens } from "./moralis";
import { EvmWalletPnlResult, EvmTokenTrade, OutgoingTransfer, TradeStyle } from "../types";

// Native token address placeholder used by Moralis for ETH/BNB
const NATIVE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

// Map chain string → native token coingecko ID for price fetch
const NATIVE_IDS: Record<string, string> = {
  eth:     "ethereum",
  "0x1":   "ethereum",
  bsc:     "binancecoin",
  "0x38":  "binancecoin",
  base:    "ethereum",
  "0x2105":"ethereum",
  arbitrum:"ethereum",
  "0xa4b1":"ethereum",
};

async function getNativePrice(chain: string): Promise<number> {
  const id = NATIVE_IDS[chain] || "ethereum";
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`
    );
    const json = (await res.json()) as any;
    return json[id]?.usd || 0;
  } catch {
    return 0;
  }
}

function tradingStyle(medianSeconds: number): TradeStyle {
  if (medianSeconds <= 0) return "mixed";
  if (medianSeconds < 3600)      return "scalper";
  if (medianSeconds < 86400)     return "day";
  if (medianSeconds < 7 * 86400) return "swing";
  return "holder";
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export async function getEvmWalletPnl(
  address: string,
  chain: string = "eth"
): Promise<EvmWalletPnlResult> {
  const [swaps, transfers, nativePrice] = await Promise.all([
    getEvmWalletSwaps(address, chain, 200),
    getEvmWalletTransfers(address, chain, 100),
    getNativePrice(chain),
  ]);

  // ── Build per-token trade buckets ──────────────────────────────────────────
  // Key: tokenAddress (lowercase)
  interface Acc {
    symbol: string;
    usdIn: number;
    usdOut: number;
    firstBuyTs: number;
    lastTs: number;
    holdTimes: number[];
    lastBuyTs: number;
  }
  const map = new Map<string, Acc>();

  for (const s of swaps) {
    const ts = Math.floor(new Date(s.blockTimestamp).getTime() / 1000);
    const usd = s.amountUsd;

    // tokenIn = what was spent, tokenOut = what was received
    // A "buy" = you spend ETH/stablecoin to get a token
    // A "sell" = you spend a token to get ETH/stablecoin
    const inAddr  = s.tokenIn.address.toLowerCase();
    const outAddr = s.tokenOut.address.toLowerCase();
    const isNativeIn  = inAddr  === NATIVE || s.tokenIn.symbol  === "ETH" || s.tokenIn.symbol  === "BNB" || s.tokenIn.symbol  === "WETH" || s.tokenIn.symbol === "WBNB";
    const isNativeOut = outAddr === NATIVE || s.tokenOut.symbol === "ETH" || s.tokenOut.symbol === "BNB" || s.tokenOut.symbol === "WETH" || s.tokenOut.symbol === "WBNB";

    if (isNativeIn && !isNativeOut) {
      // BUY: spent native, received token
      const key = outAddr;
      if (!map.has(key)) map.set(key, { symbol: s.tokenOut.symbol, usdIn: 0, usdOut: 0, firstBuyTs: ts, lastTs: ts, holdTimes: [], lastBuyTs: ts });
      const acc = map.get(key)!;
      acc.usdIn += usd;
      acc.lastBuyTs = ts;
      acc.lastTs = Math.max(acc.lastTs, ts);
      acc.firstBuyTs = Math.min(acc.firstBuyTs, ts);
    } else if (!isNativeIn && isNativeOut) {
      // SELL: spent token, received native
      const key = inAddr;
      if (!map.has(key)) map.set(key, { symbol: s.tokenIn.symbol, usdIn: 0, usdOut: 0, firstBuyTs: ts, lastTs: ts, holdTimes: [], lastBuyTs: 0 });
      const acc = map.get(key)!;
      acc.usdOut += usd;
      acc.lastTs = Math.max(acc.lastTs, ts);
      if (acc.lastBuyTs > 0) {
        acc.holdTimes.push(ts - acc.lastBuyTs);
      }
    }
  }

  // ── Build trades ───────────────────────────────────────────────────────────
  const trades: EvmTokenTrade[] = [];
  for (const [addr, acc] of map.entries()) {
    if (acc.usdIn === 0 && acc.usdOut === 0) continue;
    const pnlUsd = acc.usdOut - acc.usdIn;
    const pnlRatio = acc.usdIn > 0 ? pnlUsd / acc.usdIn : 0;
    const isOpen = acc.usdIn > 0 && acc.usdOut < acc.usdIn * 0.95;
    const holdSec = acc.holdTimes.length > 0 ? median(acc.holdTimes) : 0;
    trades.push({
      tokenAddress: addr,
      symbol: acc.symbol,
      ethIn: nativePrice > 0 ? acc.usdIn / nativePrice : 0,
      ethOut: nativePrice > 0 ? acc.usdOut / nativePrice : 0,
      usdIn: acc.usdIn,
      usdOut: acc.usdOut,
      pnlUsd,
      pnlRatio,
      isOpen,
      firstBuyTs: acc.firstBuyTs,
      lastTs: acc.lastTs,
      holdingSeconds: holdSec,
    });
  }

  // Sort by abs PnL desc
  trades.sort((a, b) => Math.abs(b.pnlUsd) - Math.abs(a.pnlUsd));

  // ── Stats ──────────────────────────────────────────────────────────────────
  const closed = trades.filter((t) => !t.isOpen);
  const wins   = closed.filter((t) => t.pnlUsd > 0).length;
  const losses = closed.filter((t) => t.pnlUsd <= 0).length;
  const totalCostUsd  = trades.reduce((s, t) => s + t.usdIn, 0);
  const totalPnlUsd   = trades.reduce((s, t) => s + t.pnlUsd, 0);
  const pnlRatio      = totalCostUsd > 0 ? totalPnlUsd / totalCostUsd : 0;
  const winrate       = closed.length > 0 ? (wins / closed.length) * 100 : 0;
  const openPositions = trades.filter((t) => t.isOpen).length;
  const holdTimes     = closed.filter((t) => t.holdingSeconds > 0).map((t) => t.holdingSeconds);
  const medianHold    = median(holdTimes);

  // ── Outgoing transfers ─────────────────────────────────────────────────────
  const outgoing: OutgoingTransfer[] = transfers
    .filter((t) => t.valueUsd > 1)
    .map((t) => ({
      mint: t.tokenAddress,
      symbol: t.symbol,
      amount: t.amount,
      toAddress: t.toAddress,
      timestamp: Math.floor(new Date(t.blockTimestamp).getTime() / 1000),
    }));

  return {
    address,
    chain,
    totalTrades: trades.length,
    wins,
    losses,
    openPositions,
    winrate,
    pnlRatio,
    totalPnlUsd,
    totalCostUsd,
    nativePriceUsd: nativePrice,
    tradingStyle: tradingStyle(medianHold),
    medianHoldingSeconds: medianHold,
    trades,
    outgoingTransfers: outgoing,
  };
}
