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

// ─── Wallet Swap History ────────────────────────────────────────────────────

export async function getWalletSwapHistory(
  address: string,
  limit: number = 100
): Promise<SwapTransaction[]> {
  const cacheKey = `swaps:${address}:${limit}`;
  const cached = cacheGet<SwapTransaction[]>(cacheKey);
  if (cached) return cached;

  const url = `${HELIUS_API}/addresses/${address}/transactions?api-key=${config.heliusApiKey}&type=SWAP&limit=${limit}`;
  const res = await fetch(url);
  const json = (await res.json()) as any;

  if (!Array.isArray(json)) return [];

  const mintMap = new Map<string, SwapTransaction>();

  for (const tx of json) {
    const timestamp: number = tx.timestamp || 0;
    const transfers: any[] = tx.tokenTransfers || [];

    for (const transfer of transfers) {
      const mint: string = transfer.mint || "";
      const symbol: string = transfer.tokenStandard || mint.slice(0, 6);
      const amount: number = Number(transfer.tokenAmount) || 0;

      if (!mint) continue;

      const existing = mintMap.get(mint) || { mint, symbol, bought: 0, sold: 0, timestamp };

      if (transfer.toUserAccount === address) {
        existing.bought += amount;
      } else if (transfer.fromUserAccount === address) {
        existing.sold += amount;
      }

      mintMap.set(mint, existing);
    }
  }

  const result = Array.from(mintMap.values());
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
// FIX: Get 1000 oldest signatures, parse via Helius Enhanced API (nativeTransfers)

export async function getWalletFirstFunder(address: string): Promise<FunderInfo> {
  const cacheKey = `funder:${address}`;
  const cached = cacheGet<FunderInfo>(cacheKey);
  if (cached) return cached;

  const empty: FunderInfo = { funder: null, amount: 0, timestamp: 0 };

  // Get up to 1000 signatures (newest first). The last ones are the OLDEST.
  const sigBody = {
    jsonrpc: "2.0",
    id: 1,
    method: "getSignaturesForAddress",
    params: [address, { limit: 1000, commitment: "confirmed" }],
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

  // The LAST entries are the OLDEST transactions — that's where the first funding is.
  // Take the 5 oldest signatures to maximize chance of finding the first SOL transfer.
  const oldestSigs = sigs.slice(-5).map((s: any) => s.signature);

  await new Promise((r) => setTimeout(r, 200));

  // Use Helius Enhanced API: returns nativeTransfers parsed cleanly
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

  // Sort by timestamp ascending so we check the truly oldest first
  parsedTxs.sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0));

  for (const tx of parsedTxs) {
    const nativeTransfers: any[] = tx.nativeTransfers || [];

    for (const transfer of nativeTransfers) {
      if (
        transfer.toUserAccount === address &&
        transfer.fromUserAccount &&
        transfer.fromUserAccount !== address &&
        transfer.amount > 0
      ) {
        const funderInfo: FunderInfo = {
          funder: transfer.fromUserAccount,
          amount: transfer.amount / 1e9, // lamports → SOL
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
