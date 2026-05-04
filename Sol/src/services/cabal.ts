import { getTokenEarlyBuyers } from "./pumpfun";
import { getWalletFirstFunder, getEarlyBuyersFromChain } from "./helius_extended";
import { getTokenInfo } from "./dexscreener";
import { KNOWN_WALLETS } from "./labels";
import {
  SniperWallet,
  SniperCluster,
  SniperAnalysisResult,
} from "../types";
import { cacheGet, cacheSet } from "../utils/cache";
import { config } from "../config";

const EARLY_BUYERS_CHECK = 20;      // how many early buyers per token
const AMOUNT_TOLERANCE = 0.005;     // SOL tolerance for "same amount" clustering
const GAP_TOLERANCE_SECONDS = 15;   // tolerance for "same timing pattern"

function sameAmount(a: number, b: number): boolean {
  return Math.abs(a - b) <= AMOUNT_TOLERANCE;
}

function sameGap(a: number, b: number): boolean {
  return Math.abs(a - b) <= GAP_TOLERANCE_SECONDS;
}

function labelFor(address: string | null): string | null {
  if (!address) return null;
  return KNOWN_WALLETS[address]?.name || null;
}

/**
 * Analyze a cabal by cross-referencing early buyers of multiple tokens.
 * Groups wallets by funder/amount/timing patterns to detect sniper bots.
 */
export async function analyzeSniperCabal(
  mints: string[]
): Promise<SniperAnalysisResult> {
  const cacheKey = `cabal:${mints.sort().join(",")}`;
  const cached = cacheGet<SniperAnalysisResult>(cacheKey);
  if (cached) return cached;

  // ── Step 1: fetch early buyers + token info for each token ─────────────
  // Try pump.fun first; fall back to on-chain parsing for bonk.fun / Raydium / etc.
  const tokenInfos = await Promise.all(
    mints.map(async (mint) => {
      const info = await getTokenInfo(mint).catch(() => null);
      let buyers = await getTokenEarlyBuyers(mint).catch(() => []);

      if (buyers.length === 0) {
        const chainBuyers = await getEarlyBuyersFromChain(mint, EARLY_BUYERS_CHECK).catch(() => []);
        buyers = chainBuyers.map((b) => ({
          wallet: b.wallet,
          solAmount: b.solAmount,
          tokenAmount: b.tokenAmount,
          timestamp: b.timestamp,
        }));
      }

      return {
        mint,
        symbol: info?.symbol || mint.slice(0, 6),
        buyers: buyers.slice(0, EARLY_BUYERS_CHECK),
      };
    })
  );

  // ── Step 2: build map of wallet → list of tokens sniped ────────────────
  const walletMap = new Map<
    string,
    { mint: string; symbol: string; solBought: number; timestamp: number }[]
  >();

  for (const t of tokenInfos) {
    for (const buyer of t.buyers) {
      if (!buyer.wallet || buyer.wallet === "unknown") continue;
      if (!walletMap.has(buyer.wallet)) walletMap.set(buyer.wallet, []);
      walletMap.get(buyer.wallet)!.push({
        mint: t.mint,
        symbol: t.symbol,
        solBought: buyer.solAmount,
        timestamp: buyer.timestamp,
      });
    }
  }

  // ── Step 3: for each unique wallet, fetch its first funder ─────────────
  // Throttle to respect Helius rate limit (10 RPS general)
  const snipers: SniperWallet[] = [];
  const wallets = Array.from(walletMap.keys());

  for (const wallet of wallets) {
    try {
      const funder = await getWalletFirstFunder(wallet);
      const tokensSniped = walletMap.get(wallet)!;
      const firstBuy = tokensSniped.reduce(
        (earliest, t) => (t.timestamp < earliest ? t.timestamp : earliest),
        tokensSniped[0].timestamp
      );
      const gap = funder.timestamp > 0 ? firstBuy - funder.timestamp : -1;

      snipers.push({
        address: wallet,
        tokensSniped,
        funder: funder.funder,
        funderLabel: labelFor(funder.funder),
        fundingAmount: funder.amount,
        fundingTimestamp: funder.timestamp,
        gapSecondsBeforeFirstBuy: gap,
      });
    } catch {}
    await new Promise((r) => setTimeout(r, 150));
  }

  // ── Step 4: cluster by shared patterns ─────────────────────────────────
  const clusters: SniperCluster[] = [];
  const orphans: SniperWallet[] = [];
  const assigned = new Set<string>();
  let clusterIdx = 0;
  const letter = () => String.fromCharCode(65 + clusterIdx++);

  // Cluster 1 (strongest signal): wallets that sniped 2+ tokens
  // — a single wallet hitting multiple launches is already a cabal member
  const multiTokenSnipers = snipers.filter((s) => s.tokensSniped.length >= 2);
  if (multiTokenSnipers.length >= 1 && mints.length >= 2) {
    clusters.push({
      id: letter(),
      reason: `Sniped ${multiTokenSnipers.length >= 2 ? "multiple" : "2+"} tokens — same wallet across launches`,
      sharedFunder: null,
      sharedAmount: null,
      wallets: multiTokenSnipers,
    });
    multiTokenSnipers.forEach((s) => assigned.add(s.address));
  }

  // Cluster 2: shared exact funder (treasury signature)
  const byFunder = new Map<string, SniperWallet[]>();
  for (const s of snipers) {
    if (assigned.has(s.address) || !s.funder) continue;
    if (!byFunder.has(s.funder)) byFunder.set(s.funder, []);
    byFunder.get(s.funder)!.push(s);
  }
  for (const [funder, group] of byFunder.entries()) {
    if (group.length >= 2) {
      clusters.push({
        id: letter(),
        reason: `Same funder (${group.length} wallets) — shared treasury`,
        sharedFunder: funder,
        sharedAmount: null,
        wallets: group,
      });
      group.forEach((s) => assigned.add(s.address));
    }
  }

  // Cluster 3: same exact funding amount (deploy script signature)
  // CRITICAL: exclude fundingAmount === 0 (those are "unknown", not zero)
  const remainingForAmount = snipers.filter(
    (s) => !assigned.has(s.address) && s.fundingAmount > 0.0001
  );
  const byAmountGroups: SniperWallet[][] = [];
  for (const s of remainingForAmount) {
    const existing = byAmountGroups.find((g) => sameAmount(g[0].fundingAmount, s.fundingAmount));
    if (existing) existing.push(s);
    else byAmountGroups.push([s]);
  }
  for (const group of byAmountGroups) {
    if (group.length >= 2) {
      clusters.push({
        id: letter(),
        reason: `Same funding amount ${group[0].fundingAmount.toFixed(3)} SOL (${group.length} wallets) — deploy script`,
        sharedFunder: null,
        sharedAmount: group[0].fundingAmount,
        wallets: group,
      });
      group.forEach((s) => assigned.add(s.address));
    }
  }

  // Cluster 4: same buy amount across tokens (copy-paste sniper config)
  // e.g. wallets that all bought exactly 0.288 SOL — strong signal
  const remainingForBuy = snipers.filter((s) => !assigned.has(s.address));
  const byBuyGroups: SniperWallet[][] = [];
  for (const s of remainingForBuy) {
    // Use the sniper's largest buy as signature
    const maxBuy = Math.max(...s.tokensSniped.map((t) => t.solBought));
    if (maxBuy < 0.01) continue; // ignore dust buys
    const existing = byBuyGroups.find((g) => {
      const gMax = Math.max(...g[0].tokensSniped.map((t) => t.solBought));
      return sameAmount(gMax, maxBuy);
    });
    if (existing) existing.push(s);
    else byBuyGroups.push([s]);
  }
  for (const group of byBuyGroups) {
    if (group.length >= 3) {
      const amt = Math.max(...group[0].tokensSniped.map((t) => t.solBought));
      clusters.push({
        id: letter(),
        reason: `Same buy size ~${amt.toFixed(3)} SOL (${group.length} wallets) — copy-paste sniper config`,
        sharedFunder: null,
        sharedAmount: amt,
        wallets: group,
      });
      group.forEach((s) => assigned.add(s.address));
    }
  }

  // Cluster 5: same timing gap funding→buy (scripted bot)
  const remainingForGap = snipers.filter(
    (s) => !assigned.has(s.address) && s.gapSecondsBeforeFirstBuy >= 0
  );
  const byGapGroups: SniperWallet[][] = [];
  for (const s of remainingForGap) {
    const existing = byGapGroups.find((g) => sameGap(g[0].gapSecondsBeforeFirstBuy, s.gapSecondsBeforeFirstBuy));
    if (existing) existing.push(s);
    else byGapGroups.push([s]);
  }
  for (const group of byGapGroups) {
    if (group.length >= 2) {
      clusters.push({
        id: letter(),
        reason: `Same timing pattern ~${group[0].gapSecondsBeforeFirstBuy}s gap (${group.length} wallets) — scripted bot`,
        sharedFunder: null,
        sharedAmount: null,
        wallets: group,
      });
      group.forEach((s) => assigned.add(s.address));
    }
  }

  // Whatever remains is orphan
  for (const s of snipers) {
    if (!assigned.has(s.address)) orphans.push(s);
  }

  const result: SniperAnalysisResult = {
    tokens: tokenInfos.map((t) => ({ mint: t.mint, symbol: t.symbol })),
    totalSnipers: snipers.length,
    clusters,
    orphans,
  };

  cacheSet(cacheKey, result, config.cacheTtl);
  return result;
}
