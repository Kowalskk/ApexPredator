import { config } from "../config";
import { cacheGet, cacheSet } from "../utils/cache";
import {
  SwapTransaction,
  WalletAgeInfo,
  FunderInfo,
  BundleResult,
} from "../types";

const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${config.heliusApiKey}`;
const HELIUS_API = `https://api.helius.xyz/v0`;

// ─── Wallet PnL Analysis ────────────────────────────────────────────────────

const SOL_MINT = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const STABLECOIN_MINTS = new Set([USDC_MINT, USDT_MINT]);

async function getSolPrice(): Promise<number> {
  try {
    const res = await fetch(`https://api.jup.ag/price/v2?ids=${SOL_MINT}`);
    const json = (await res.json()) as any;
    return parseFloat(json?.data?.[SOL_MINT]?.price || "150");
  } catch {
    return 150;
  }
}

async function fetchAllTransactions(address: string, limit: number): Promise<any[]> {
  // Fetch SWAP + TRANSFER types
  const types = ["SWAP", "TRANSFER"];
  const results: any[] = [];

  for (const type of types) {
    const url = `${HELIUS_API}/addresses/${address}/transactions?api-key=${config.heliusApiKey}&type=${type}&limit=${limit}`;
    try {
      const res = await fetch(url);
      const json = (await res.json()) as any;
      if (Array.isArray(json)) results.push(...json);
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }

  // Also fetch ADD_LIQUIDITY and REMOVE_LIQUIDITY
  for (const type of ["ADD_LIQUIDITY", "REMOVE_LIQUIDITY"]) {
    const url = `${HELIUS_API}/addresses/${address}/transactions?api-key=${config.heliusApiKey}&type=${type}&limit=50`;
    try {
      const res = await fetch(url);
      const json = (await res.json()) as any;
      if (Array.isArray(json)) results.push(...json);
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }

  return results;
}

import {
  WalletPnlResult,
  TokenTrade,
  LpActivity,
  OutgoingTransfer,
} from "../types";

// Resolve real token symbols for a set of mints via DexScreener (batched)
async function resolveSymbols(mints: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (mints.length === 0) return map;

  // DexScreener supports up to 30 mints per call
  const chunks: string[][] = [];
  for (let i = 0; i < mints.length; i += 30) chunks.push(mints.slice(i, i + 30));

  for (const chunk of chunks) {
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${chunk.join(",")}`);
      const json = (await res.json()) as any;
      for (const pair of (json.pairs || [])) {
        const mint: string = pair.baseToken?.address || "";
        const symbol: string = pair.baseToken?.symbol || "";
        if (mint && symbol && !map.has(mint)) map.set(mint, symbol);
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  return map;
}

export async function getWalletPnl(
  address: string,
  limit: number = 100
): Promise<WalletPnlResult> {
  const cacheKey = `pnl:${address}:${limit}`;
  const cached = cacheGet<WalletPnlResult>(cacheKey);
  if (cached) return cached;

  const [txs, solPrice] = await Promise.all([
    fetchAllTransactions(address, limit),
    getSolPrice(),
  ]);

  // ── Per-token accumulators ──────────────────────────────────────────────
  interface TradeAcc {
    symbol: string;
    solIn: number;
    solOut: number;
    tokenBought: number;
    tokenSold: number;
    firstBuyTs: number;
    lastSellTs: number;
    lastTimestamp: number;
  }

  const tradeMap = new Map<string, TradeAcc>();
  const lpMap = new Map<string, { symbol: string; solIn: number; solOut: number }>();
  const transfers: OutgoingTransfer[] = [];

  const getOrCreate = (mint: string, symbol: string): TradeAcc => {
    if (!tradeMap.has(mint)) {
      tradeMap.set(mint, { symbol, solIn: 0, solOut: 0, tokenBought: 0, tokenSold: 0, firstBuyTs: 0, lastSellTs: 0, lastTimestamp: 0 });
    }
    return tradeMap.get(mint)!;
  };

  for (const tx of txs) {
    const ts: number = tx.timestamp || 0;
    const txType: string = tx.type || "";
    const tokenTransfers: any[] = tx.tokenTransfers || [];

    if (txType === "SWAP") {
      // SOL flows are in tokenTransfers with mint === SOL_MINT (wSOL)
      // wallet sends wSOL → BUY;  wallet receives wSOL → SELL
      const solSent = tokenTransfers
        .filter((t: any) => t.mint === SOL_MINT && t.fromUserAccount === address)
        .reduce((s: number, t: any) => s + (Number(t.tokenAmount) || 0), 0);

      const solReceived = tokenTransfers
        .filter((t: any) => t.mint === SOL_MINT && t.toUserAccount === address)
        .reduce((s: number, t: any) => s + (Number(t.tokenAmount) || 0), 0);

      // Find the non-SOL token in this swap
      for (const transfer of tokenTransfers) {
        const mint: string = transfer.mint || "";
        if (!mint || mint === SOL_MINT || STABLECOIN_MINTS.has(mint)) continue;

        const symbol: string = transfer.symbol || mint.slice(0, 6);
        const acc = getOrCreate(mint, symbol);
        acc.lastTimestamp = Math.max(acc.lastTimestamp, ts);

        if (transfer.toUserAccount === address) {
          // Received token → BUY
          acc.tokenBought += Number(transfer.tokenAmount) || 0;
          acc.solIn += solSent;
          if (acc.firstBuyTs === 0 || ts < acc.firstBuyTs) acc.firstBuyTs = ts;
        } else if (transfer.fromUserAccount === address) {
          // Sent token → SELL
          acc.tokenSold += Number(transfer.tokenAmount) || 0;
          acc.solOut += solReceived;
          if (ts > acc.lastSellTs) acc.lastSellTs = ts;
        }
      }
    } else if (txType === "ADD_LIQUIDITY") {
      const solSentLp = tokenTransfers
        .filter((t: any) => t.mint === SOL_MINT && t.fromUserAccount === address)
        .reduce((s: number, t: any) => s + (Number(t.tokenAmount) || 0), 0);
      for (const transfer of tokenTransfers) {
        const mint: string = transfer.mint || "";
        if (!mint || mint === SOL_MINT || STABLECOIN_MINTS.has(mint)) continue;
        const symbol: string = transfer.symbol || mint.slice(0, 6);
        if (!lpMap.has(mint)) lpMap.set(mint, { symbol, solIn: 0, solOut: 0 });
        lpMap.get(mint)!.solIn += solSentLp;
      }
    } else if (txType === "REMOVE_LIQUIDITY") {
      const solReceivedLp = tokenTransfers
        .filter((t: any) => t.mint === SOL_MINT && t.toUserAccount === address)
        .reduce((s: number, t: any) => s + (Number(t.tokenAmount) || 0), 0);
      for (const transfer of tokenTransfers) {
        const mint: string = transfer.mint || "";
        if (!mint || mint === SOL_MINT || STABLECOIN_MINTS.has(mint)) continue;
        const symbol: string = transfer.symbol || mint.slice(0, 6);
        if (!lpMap.has(mint)) lpMap.set(mint, { symbol, solIn: 0, solOut: 0 });
        lpMap.get(mint)!.solOut += solReceivedLp;
      }
    } else if (txType === "TRANSFER") {
      for (const transfer of tokenTransfers) {
        const mint: string = transfer.mint || "";
        if (!mint || mint === SOL_MINT || STABLECOIN_MINTS.has(mint)) continue;
        if (transfer.fromUserAccount === address && transfer.toUserAccount !== address) {
          transfers.push({
            mint,
            symbol: transfer.symbol || transfer.tokenStandard || mint.slice(0, 6),
            amount: Number(transfer.tokenAmount) || 0,
            toAddress: transfer.toUserAccount || "",
            timestamp: ts,
          });
        }
      }
    }
  }

  // ── Resolve real symbols for all mints via DexScreener ─────────────────
  const allMints = [
    ...Array.from(tradeMap.keys()),
    ...Array.from(lpMap.keys()),
    ...transfers.map((t) => t.mint),
  ];
  const symbolMap = await resolveSymbols([...new Set(allMints)]);

  const resolvedSymbol = (mint: string, fallback: string): string => {
    const s = symbolMap.get(mint);
    // Only use fallback if DexScreener gave nothing or gave a generic type name
    if (s && s !== "FUNGIBLE" && s !== "NonFungible") return s;
    if (fallback !== "FUNGIBLE" && fallback !== "NonFungible") return fallback;
    return mint.slice(0, 6);
  };

  // ── Build TokenTrade results ────────────────────────────────────────────
  const trades: TokenTrade[] = [];
  for (const [mint, acc] of tradeMap.entries()) {
    if (acc.solIn === 0 && acc.solOut === 0) continue;
    const pnlSol = acc.solOut - acc.solIn;
    const isOpen = acc.tokenBought > acc.tokenSold * 1.01;
    const holdingSeconds =
      !isOpen && acc.firstBuyTs > 0 && acc.lastSellTs > 0
        ? acc.lastSellTs - acc.firstBuyTs
        : 0;
    const pnlRatio = acc.solIn > 0 ? pnlSol / acc.solIn : 0;
    trades.push({
      mint,
      symbol: resolvedSymbol(mint, acc.symbol),
      solIn: acc.solIn,
      solOut: acc.solOut,
      pnlSol,
      pnlUsd: pnlSol * solPrice,
      pnlRatio,
      isOpen,
      firstBuyTs: acc.firstBuyTs,
      lastSellTs: acc.lastSellTs,
      holdingSeconds,
      lastTimestamp: acc.lastTimestamp,
    });
  }
  trades.sort((a, b) => Math.abs(b.pnlUsd) - Math.abs(a.pnlUsd));

  // ── Build LP results ────────────────────────────────────────────────────
  const lpActivities: LpActivity[] = [];
  for (const [mint, lp] of lpMap.entries()) {
    const pnlSol = lp.solOut - lp.solIn;
    lpActivities.push({
      mint,
      symbol: resolvedSymbol(mint, lp.symbol),
      solDeposited: lp.solIn,
      solWithdrawn: lp.solOut,
      pnlSol,
      pnlUsd: pnlSol * solPrice,
    });
  }

  // ── Deduplicate outgoing transfers: group by mint+destination, keep largest ─
  const transferKey = (t: OutgoingTransfer) => `${t.mint}:${t.toAddress}`;
  const transferDedup = new Map<string, OutgoingTransfer>();
  for (const t of transfers) {
    const key = transferKey(t);
    const existing = transferDedup.get(key);
    if (!existing || t.amount > existing.amount) {
      transferDedup.set(key, {
        ...t,
        symbol: resolvedSymbol(t.mint, t.symbol),
      });
    }
  }
  // Filter out dust transfers (< 1000 tokens) and keep max 10
  const cleanTransfers = Array.from(transferDedup.values())
    .filter((t) => t.amount >= 1000)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  // ── Aggregate stats ─────────────────────────────────────────────────────
  const closedTrades = trades.filter((t) => !t.isOpen);
  const wins = closedTrades.filter((t) => t.pnlSol > 0).length;
  const losses = closedTrades.filter((t) => t.pnlSol <= 0).length;
  const openPositions = trades.filter((t) => t.isOpen).length;
  const winrate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;

  const swapPnlSol = trades.reduce((s, t) => s + t.pnlSol, 0);
  const swapPnlUsd = swapPnlSol * solPrice;
  const lpPnlSol = lpActivities.reduce((s, l) => s + l.pnlSol, 0);
  const lpPnlUsd = lpPnlSol * solPrice;

  // GMGN-style PnL ratio: total_profit / total_cost
  const totalCostSol = trades.reduce((s, t) => s + t.solIn, 0);
  const totalCostUsd = totalCostSol * solPrice;
  const pnlRatio = totalCostSol > 0 ? swapPnlSol / totalCostSol : 0;

  // Trading style: median holding time bucket
  const durations = closedTrades.map((t) => t.holdingSeconds).filter((d) => d > 0).sort((a, b) => a - b);
  const medianHoldingSeconds = durations.length > 0 ? durations[Math.floor(durations.length / 2)] : 0;

  let tradingStyle: import("../types").TradeStyle = "mixed";
  if (durations.length >= 3) {
    const hour = 3600;
    const day = 86400;
    if (medianHoldingSeconds < hour) tradingStyle = "scalper";
    else if (medianHoldingSeconds < day) tradingStyle = "day";
    else if (medianHoldingSeconds < 7 * day) tradingStyle = "swing";
    else tradingStyle = "holder";
  }

  const result: WalletPnlResult = {
    address,
    totalTrades: closedTrades.length,
    wins,
    losses,
    openPositions,
    winrate,
    pnlRatio,
    swapPnlSol,
    swapPnlUsd,
    lpPnlSol,
    lpPnlUsd,
    totalPnlUsd: swapPnlUsd + lpPnlUsd,
    totalCostUsd,
    solPriceUsd: solPrice,
    tradingStyle,
    medianHoldingSeconds,
    trades,
    lpActivities,
    outgoingTransfers: cleanTransfers,
    txCount: txs.length,
  };

  cacheSet(cacheKey, result, config.cacheTtl);
  return result;
}

// ─── Legacy (kept for other commands that use it) ────────────────────────────
export async function getWalletSwapHistory(
  _address: string,
  _limit: number = 100
): Promise<SwapTransaction[]> {
  return [];
}

// ─── Generic early buyers (works for any launchpad: bonk.fun, Raydium, etc) ──

export interface ChainEarlyBuyer {
  wallet: string;
  solAmount: number;
  tokenAmount: number;
  timestamp: number;
  slot: number;
}

export async function getEarlyBuyersFromChain(
  mint: string,
  maxBuyers: number = 30
): Promise<ChainEarlyBuyer[]> {
  const cacheKey = `earlychain:${mint}:${maxBuyers}`;
  const cached = cacheGet<ChainEarlyBuyer[]>(cacheKey);
  if (cached) return cached;

  // Step 1: paginate through signatures to reach the oldest ones
  const allSigs: any[] = [];
  let before: string | undefined;
  const MAX_PAGES = 3;

  for (let page = 0; page < MAX_PAGES; page++) {
    const body = {
      jsonrpc: "2.0",
      id: 1,
      method: "getSignaturesForAddress",
      params: [mint, { limit: 1000, commitment: "confirmed", ...(before ? { before } : {}) }],
    };
    const res = await fetch(HELIUS_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json()) as any;
    const sigs: any[] = json.result || [];
    if (sigs.length === 0) break;
    allSigs.push(...sigs);
    before = sigs[sigs.length - 1]?.signature;
    if (sigs.length < 1000) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  if (allSigs.length === 0) return [];

  // Sort by slot ascending — oldest first = deploy + early buys
  const sortedOldest = [...allSigs]
    .sort((a: any, b: any) => (a.slot || 0) - (b.slot || 0))
    .slice(0, 60);

  const sigList = sortedOldest.map((s: any) => s.signature);

  // Step 2: parse via Helius Enhanced API
  const parseRes = await fetch(
    `${HELIUS_API}/transactions?api-key=${config.heliusApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions: sigList }),
    }
  );
  const parsedTxs = (await parseRes.json()) as any;
  if (!Array.isArray(parsedTxs)) return [];

  parsedTxs.sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0));

  // Step 3: extract unique early buyers
  const buyerMap = new Map<string, ChainEarlyBuyer>();

  for (const tx of parsedTxs) {
    if (buyerMap.size >= maxBuyers) break;
    const ts: number = tx.timestamp || 0;
    const slot: number = tx.slot || 0;
    const tokenTransfers: any[] = tx.tokenTransfers || [];

    for (const tt of tokenTransfers) {
      if (tt.mint !== mint) continue;
      const buyer: string = tt.toUserAccount;
      if (!buyer || buyerMap.has(buyer)) continue;

      const solSpent = tokenTransfers
        .filter((t: any) => t.mint === SOL_MINT && t.fromUserAccount === buyer)
        .reduce((s: number, t: any) => s + (Number(t.tokenAmount) || 0), 0);

      buyerMap.set(buyer, {
        wallet: buyer,
        solAmount: solSpent,
        tokenAmount: Number(tt.tokenAmount) || 0,
        timestamp: ts,
        slot,
      });
    }
  }

  const result = Array.from(buyerMap.values()).sort((a, b) => a.timestamp - b.timestamp);
  cacheSet(cacheKey, result, config.cacheTtl);
  return result;
}

// ─── Token First Transactions ───────────────────────────────────────────────

export interface TokenSignature {
  signature: string;
  slot: number;
  blockTime: number;
}

export async function getTokenFirstTransactions(
  mint: string,
  limit: number = 200
): Promise<TokenSignature[]> {
  const cacheKey = `firsttx:${mint}:${limit}`;
  const cached = cacheGet<TokenSignature[]>(cacheKey);
  if (cached) return cached;

  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getSignaturesForAddress",
    params: [mint, { limit, commitment: "confirmed" }],
  };

  const res = await fetch(HELIUS_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as any;
  const sigs: any[] = json.result || [];

  const result: TokenSignature[] = sigs.map((s: any) => ({
    signature: s.signature,
    slot: s.slot || 0,
    blockTime: s.blockTime || 0,
  }));

  cacheSet(cacheKey, result, config.cacheTtl);
  return result;
}

// ─── Check Wallet Age ────────────────────────────────────────────────────────

export async function checkWalletAge(address: string): Promise<WalletAgeInfo> {
  const cacheKey = `walletage:${address}`;
  const cached = cacheGet<WalletAgeInfo>(cacheKey);
  if (cached) return cached;

  const body = {
    jsonrpc: "2.0",
    id: 1,
    method: "getSignaturesForAddress",
    params: [address, { limit: 100, commitment: "confirmed" }],
  };

  const res = await fetch(HELIUS_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = (await res.json()) as any;
  const sigs: any[] = json.result || [];

  const txCount = sigs.length;
  const oldest = sigs[sigs.length - 1];
  const firstTxTimestamp: number = oldest?.blockTime || 0;

  const thirtyDaysAgo = Math.floor(Date.now() / 1000) - 30 * 24 * 3600;
  const isFresh =
    txCount < 20 || (firstTxTimestamp > 0 && firstTxTimestamp > thirtyDaysAgo);

  const result: WalletAgeInfo = { address, firstTxTimestamp, txCount, isFresh };

  cacheSet(cacheKey, result, config.cacheTtl);
  return result;
}

// ─── Wallet First Funder ─────────────────────────────────────────────────────
// Paginate to the TRUE oldest sig, then parse 10 via Enhanced API.
// Fallback: if Enhanced returns nothing useful, the wallet's first SOL-in is not
// in nativeTransfers (can happen with bonk.fun buys where SOL comes via wSOL).

export async function getWalletFirstFunder(address: string): Promise<FunderInfo> {
  const cacheKey = `funder:${address}`;
  const cached = cacheGet<FunderInfo>(cacheKey);
  if (cached) return cached;

  const empty: FunderInfo = { funder: null, amount: 0, timestamp: 0 };

  // ── Paginate to find the truly oldest signatures ──────────────────────
  let allSigs: any[] = [];
  let before: string | undefined;
  const MAX_PAGES = 3;

  for (let page = 0; page < MAX_PAGES; page++) {
    const sigBody = {
      jsonrpc: "2.0",
      id: 1,
      method: "getSignaturesForAddress",
      params: [address, { limit: 1000, commitment: "confirmed", ...(before ? { before } : {}) }],
    };
    const sigRes = await fetch(HELIUS_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sigBody),
    });
    const sigJson = (await sigRes.json()) as any;
    const sigs: any[] = sigJson.result || [];
    if (sigs.length === 0) break;
    allSigs.push(...sigs);
    before = sigs[sigs.length - 1]?.signature;
    if (sigs.length < 1000) break;
    await new Promise((r) => setTimeout(r, 150));
  }

  if (allSigs.length === 0) {
    cacheSet(cacheKey, empty, config.cacheTtl);
    return empty;
  }

  // Take the 10 oldest by blockTime
  const oldestSigs = [...allSigs]
    .sort((a: any, b: any) => (a.blockTime || 0) - (b.blockTime || 0))
    .slice(0, 10)
    .map((s: any) => s.signature);

  await new Promise((r) => setTimeout(r, 150));

  // Parse via Enhanced API — returns both nativeTransfers and tokenTransfers
  const parseRes = await fetch(
    `${HELIUS_API}/transactions?api-key=${config.heliusApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions: oldestSigs }),
    }
  );

  const parsedTxs = (await parseRes.json()) as any;
  if (!Array.isArray(parsedTxs)) {
    cacheSet(cacheKey, empty, config.cacheTtl);
    return empty;
  }

  parsedTxs.sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0));

  // Pass 1: nativeTransfers (standard SOL send)
  for (const tx of parsedTxs) {
    const nativeTransfers: any[] = tx.nativeTransfers || [];

    for (const transfer of nativeTransfers) {
      if (
        transfer.toUserAccount === address &&
        transfer.fromUserAccount &&
        transfer.fromUserAccount !== address &&
        transfer.amount > 10_000_000 // > 0.01 SOL — ignore account-creation rent
      ) {
        const funderInfo: FunderInfo = {
          funder: transfer.fromUserAccount,
          amount: transfer.amount / 1e9,
          timestamp: tx.timestamp || 0,
        };
        cacheSet(cacheKey, funderInfo, config.cacheTtl);
        return funderInfo;
      }
    }
  }

  // Pass 2: wSOL tokenTransfers fallback (bonk.fun / Raydium direct buys)
  for (const tx of parsedTxs) {
    const tokenTransfers: any[] = tx.tokenTransfers || [];
    for (const transfer of tokenTransfers) {
      if (
        transfer.mint === SOL_MINT &&
        transfer.toUserAccount === address &&
        transfer.fromUserAccount &&
        transfer.fromUserAccount !== address &&
        (Number(transfer.tokenAmount) || 0) > 0.01
      ) {
        const funderInfo: FunderInfo = {
          funder: transfer.fromUserAccount,
          amount: Number(transfer.tokenAmount) || 0,
          timestamp: tx.timestamp || 0,
        };
        cacheSet(cacheKey, funderInfo, config.cacheTtl);
        return funderInfo;
      }
    }
  }

  cacheSet(cacheKey, empty, config.cacheTtl);
  return empty;
}

// ─── Detect Bundled Wallets ─────────────────────────────────────────────────
// FIX: Use pump.fun trades API grouped by slot/timestamp for accurate bundle detection.
// Falls back to Helius Enhanced API analysis for non-pump.fun tokens.

export async function detectBundledWallets(mint: string): Promise<BundleResult> {
  const cacheKey = `bundle:${mint}`;
  const cached = cacheGet<BundleResult>(cacheKey);
  if (cached) return cached;

  const empty: BundleResult = {
    isBundled: false,
    bundledWallets: [],
    bundleSlot: 0,
    totalBundled: 0,
  };

  // Step 1: Try pump.fun trades API (most reliable for meme coins)
  try {
    const pumpRes = await fetch(
      `https://frontend-api.pump.fun/trades/all/${mint}?offset=0&limit=500&minimumSize=0`,
      { headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0" } }
    );

    if (pumpRes.ok) {
      const trades = (await pumpRes.json()) as any;

      if (Array.isArray(trades) && trades.length > 0) {
        // Sort ascending by timestamp (oldest first)
        const sorted = [...trades]
          .filter((t: any) => t.is_buy)
          .sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0));

        if (sorted.length === 0) {
          cacheSet(cacheKey, empty, config.cacheTtl);
          return empty;
        }

        const firstTimestamp: number = sorted[0].timestamp;

        // Group buys that happened within 2 seconds of the first buy (same Jito bundle = same slot = same second)
        const bundleWindowSecs = 2;
        const earlyBuys = sorted.filter(
          (t: any) => (t.timestamp || 0) <= firstTimestamp + bundleWindowSecs
        );

        // Collect unique wallets in the bundle window
        const walletSet = new Set<string>();
        for (const trade of earlyBuys) {
          const wallet = trade.user || trade.trader_public_key;
          if (wallet) walletSet.add(wallet);
        }

        const bundledWallets = [...walletSet];

        // A bundle needs at least 3 wallets buying in the same moment
        if (bundledWallets.length >= 3) {
          const result: BundleResult = {
            isBundled: true,
            bundledWallets,
            bundleSlot: firstTimestamp, // using timestamp as proxy for slot
            totalBundled: bundledWallets.length,
          };
          cacheSet(cacheKey, result, config.cacheTtl);
          return result;
        }

        cacheSet(cacheKey, empty, config.cacheTtl);
        return empty;
      }
    }
  } catch {
    // pump.fun API failed, fall through to Helius approach
  }

  // Step 2: Fallback — use Helius Enhanced API on early token transactions
  // Get first 200 signatures via RPC and parse via Enhanced API
  const sigBody = {
    jsonrpc: "2.0",
    id: 1,
    method: "getSignaturesForAddress",
    params: [mint, { limit: 200, commitment: "confirmed" }],
  };

  const sigRes = await fetch(HELIUS_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sigBody),
  });

  const sigJson = (await sigRes.json()) as any;
  const sigs: any[] = sigJson.result || [];

  if (sigs.length === 0) {
    cacheSet(cacheKey, empty, config.cacheTtl);
    return empty;
  }

  // Sort ASC to get oldest first; take first 30 (earliest activity)
  const sortedSigs = [...sigs]
    .sort((a: any, b: any) => (a.slot || 0) - (b.slot || 0))
    .slice(0, 30);

  const deploySlot: number = sortedSigs[0]?.slot || 0;
  const earlySigs = sortedSigs
    .filter((s: any) => (s.slot || 0) <= deploySlot + 5)
    .map((s: any) => s.signature);

  if (earlySigs.length <= 1) {
    cacheSet(cacheKey, empty, config.cacheTtl);
    return empty;
  }

  await new Promise((r) => setTimeout(r, 300));

  const parseRes = await fetch(
    `${HELIUS_API}/transactions?api-key=${config.heliusApiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactions: earlySigs.slice(0, 20) }),
    }
  );

  const parsedTxs = (await parseRes.json()) as any;
  if (!Array.isArray(parsedTxs)) {
    cacheSet(cacheKey, empty, config.cacheTtl);
    return empty;
  }

  // Group token receivers by slot
  const slotWallets = new Map<number, Set<string>>();

  for (const tx of parsedTxs) {
    const slot: number = tx.slot || 0;
    const transfers: any[] = tx.tokenTransfers || [];

    for (const transfer of transfers) {
      if (transfer.toUserAccount && transfer.mint === mint) {
        if (!slotWallets.has(slot)) slotWallets.set(slot, new Set());
        slotWallets.get(slot)!.add(transfer.toUserAccount);
      }
    }
  }

  let bundledWallets: string[] = [];
  let bundleSlot = 0;

  for (const [slot, wallets] of slotWallets.entries()) {
    if (wallets.size >= 3 && slot <= deploySlot + 5) {
      bundledWallets = [...wallets];
      bundleSlot = slot;
      break;
    }
  }

  const result: BundleResult = {
    isBundled: bundledWallets.length > 0,
    bundledWallets,
    bundleSlot,
    totalBundled: bundledWallets.length,
  };

  cacheSet(cacheKey, result, config.cacheTtl);
  return result;
}
