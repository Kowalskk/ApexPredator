import { cacheGet, cacheSet } from "../utils/cache";
import { config } from "../config";

// ─── Known router / aggregator / protocol addresses (lowercase) ─────────────
// Cross-chain: these contracts handle swaps for EOAs and would falsely appear
// as "buyers" in transfer history. Keep extending this list as we find more.

export const KNOWN_CONTRACTS: Record<string, string> = {
  // Uniswap
  "0xe592427a0aece92de3edee1f18e0157c05861564": "Uniswap V3 Router",
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45": "Uniswap V3 Router 2",
  "0x3fc91a3afd70395cd496c647d5a6cc9d4b2b7fad": "Universal Router",
  "0x66a9893cc07d91d95644aedd05d03f95e1dba8af": "Universal Router V4",
  "0x2626664c2603336e57b271c5c0b26f421741e481": "Uniswap V3 Router (Base)",
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d": "Uniswap V2 Router 02",

  // 1inch
  "0x1111111254eeb25477b68fb85ed929f73a960582": "1inch V5",
  "0x111111125421ca6dc452d289314280a0f8842a65": "1inch V6",
  "0x1111111254fb6c44bac0bed2854e76f90643097d": "1inch V4",

  // 0x / Matcha
  "0xdef1c0ded9bec7f1a1670819833240f027b25eff": "0x ExchangeProxy",
  "0x6131b5fae19ea4f9d964eac0408e4408b66337b5": "0x Settler / KyberSwap MetaAggregator",
  "0x0000000000001ff3684f28c67538d4d072c22734": "0x Settler V1",

  // CowSwap
  "0x9008d19f58aabd9ed0d60971565aa8510560ab41": "CoW Settlement",

  // LiFi
  "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae": "LiFi Diamond",

  // OKX DEX
  "0x3b3ae790df4f312e745d270119c6052904fb6790": "OKX Aggregator",

  // ParaSwap
  "0xdef171fe48cf0115b1d80b88dc8eab59176fee57": "ParaSwap V5",

  // Odos
  "0xcf5540fffcdc3d510b18bfca6d2b9987b0772559": "Odos Router V2",

  // Bebop
  "0xbeb09000fa59627dc02bb55448ac1893eaa501a5": "Bebop Settlement",

  // Maestro / Banana / Bonkbot style trading bots (common)
  "0x80a64c6d7f12c47b7c66c5b4e20e72bc1fcd5d9e": "Maestro Router",

  // FOMO
  "0xb92fe925dc43a0ecde6c8b1a2709c170ec4fff4f": "FOMO Relay",

  // Banana Gun
  "0x37aab97476ba8dc785476611006fd5dda4eed66b": "Banana Gun Router",
  "0xc0b66dac84a16f86c98e98d9d0540ee2eaba9e0e": "Banana Gun Router 2",

  // BSC / PancakeSwap
  "0x10ed43c718714eb63d5aa57b78b54704e256024e": "PancakeSwap V2",
  "0x13f4ea83d0bd40e75c8222255bc855a974568dd4": "PancakeSwap V3",
  "0x1a0a18ac4becddbd6389559687d1a73d8927e416": "PancakeSwap Smart Router",

  // BSC SushiSwap
  "0x1b02da8cb0d097eb8d57a175b88c7d8b47997506": "SushiSwap BSC",

  // Aerodrome (Base)
  "0xcf77a3ba9a5ca399b7c97c74d54e5b1beb874e43": "Aerodrome Router",
  "0xbe6d8f0d05cc4be24d5167a3ef062215be6d18a5": "Aerodrome CL Router",

  // Common burn / null / dead
  "0x0000000000000000000000000000000000000000": "Null Address",
  "0x000000000000000000000000000000000000dead": "Dead Address (burn)",
};

/**
 * Heuristic detection of a "vanity" contract address — many leading or
 * pattern-matching characters that suggest a deployed contract, not a personal EOA.
 * E.g. 0xb30000000..., 0x420cafe..., 0xdeadbeef...
 */
export function looksLikeVanityContract(address: string): boolean {
  const a = address.toLowerCase();
  // 6+ leading zeros after 0x
  if (/^0x0{6,}/.test(a)) return true;
  // 5+ same hex chars in a row at the start
  if (/^0x([0-9a-f])\1{4,}/.test(a)) return true;
  // Common vanity prefixes
  const prefixes = ["0xdead", "0xbeef", "0xcafe", "0x420c", "0xb300", "0x1231", "0xb92f"];
  for (const p of prefixes) if (a.startsWith(p)) return true;
  return false;
}

// ─── On-chain EOA check via eth_getCode (Ankr primary, public fallback) ──────
// EOAs return "0x" — contracts return their bytecode.

const ANKR_RPCS: Record<string, string> = {
  eth:      "https://rpc.ankr.com/eth",
  bsc:      "https://rpc.ankr.com/bsc",
  base:     "https://rpc.ankr.com/base",
  arbitrum: "https://rpc.ankr.com/arbitrum",
};

const PUBLIC_RPCS: Record<string, string> = {
  eth:      "https://eth.llamarpc.com",
  bsc:      "https://bsc-dataseed.binance.org",
  base:     "https://mainnet.base.org",
  arbitrum: "https://arb1.arbitrum.io/rpc",
};

async function tryGetCode(rpc: string, address: string): Promise<string | null> {
  try {
    const res = await fetch(rpc, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, "latest"] }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as any;
    if (j.error) return null;
    return typeof j.result === "string" ? j.result : null;
  } catch {
    return null;
  }
}

export async function isContract(address: string, chain: string): Promise<boolean> {
  const cacheKey = `iscontract:${chain}:${address.toLowerCase()}`;
  const cached = cacheGet<boolean>(cacheKey);
  if (cached !== undefined && cached !== null) return cached;

  // Quick wins: known contracts and obvious null
  const lower = address.toLowerCase();
  if (KNOWN_CONTRACTS[lower]) {
    cacheSet(cacheKey, true, config.cacheTtl);
    return true;
  }

  // 1) Ankr (con key si está configurada) → 2) Ankr público → 3) public RPC fallback
  const ankrKey = config.ankrApiKey;
  const candidates = [
    ankrKey ? `${ANKR_RPCS[chain] || ANKR_RPCS.eth}/${ankrKey}` : null,
    ANKR_RPCS[chain] || ANKR_RPCS.eth,
    PUBLIC_RPCS[chain] || PUBLIC_RPCS.eth,
  ].filter(Boolean) as string[];

  let code: string | null = null;
  for (const rpc of candidates) {
    code = await tryGetCode(rpc, address);
    if (code !== null) break;
  }

  if (code === null) {
    // No conseguimos respuesta — fail SAFE: tratamos como contrato para no colar bots
    cacheSet(cacheKey, true, 60 * 1000);
    return true;
  }
  const contract = code !== "0x" && code !== "0x0";
  cacheSet(cacheKey, contract, 60 * 60 * 1000);
  return contract;
}

// ─── Bot detection via Moralis wallet stats ──────────────────────────────────
// Two heuristics:
//  - `transactions.total` > 50K       => high-frequency trader bot (MEV, arb)
//  - `token_transfers.total` > 50K    => relay/router contract that receives
//                                         millions of token transfers but
//                                         does not initiate tx itself
// A real human KOL rarely exceeds either threshold.

const BOT_TX_THRESHOLD = 50_000;
const BOT_TRANSFER_THRESHOLD = 50_000;

export interface WalletActivity {
  txCount: number;
  tokenTransferCount: number;
}

export async function getWalletActivity(
  address: string,
  chain: string
): Promise<WalletActivity> {
  const cacheKey = `activity:${chain}:${address.toLowerCase()}`;
  const cached = cacheGet<WalletActivity>(cacheKey);
  if (cached !== undefined && cached !== null) return cached;

  const empty: WalletActivity = { txCount: 0, tokenTransferCount: 0 };
  if (!config.moralisApiKey) return empty;
  try {
    const url = `https://deep-index.moralis.io/api/v2.2/wallets/${address}/stats?chain=${chain}`;
    const res = await fetch(url, { headers: { "X-API-Key": config.moralisApiKey } });
    if (!res.ok) return empty;
    const json = (await res.json()) as any;
    const result: WalletActivity = {
      txCount: Number(json.transactions?.total ?? json.transactions?.count ?? 0) || 0,
      tokenTransferCount: Number(json.token_transfers?.total ?? json.token_transfers?.count ?? 0) || 0,
    };
    cacheSet(cacheKey, result, 60 * 60 * 1000); // 1h TTL
    return result;
  } catch {
    return empty;
  }
}

export function looksLikeBot(activity: WalletActivity): boolean {
  return (
    activity.txCount >= BOT_TX_THRESHOLD ||
    activity.tokenTransferCount >= BOT_TRANSFER_THRESHOLD
  );
}

// Tipos Arkham que NO son humanos individuales → descartar
// (cuidado: NO descartamos 'KOL', 'individual' — esos son justo lo que queremos)
const NON_HUMAN_ARKHAM_TYPES = new Set([
  "CEX", "BRIDGE", "MIXER", "SWAP_SERVICE", "DEX", "DEX_AGG",
  "MEV", "MARKET_MAKER", "CUSTODIAN", "INFRA", "LENDING", "FUND",
]);

/**
 * Filter a list of candidate addresses, returning only those that look like
 * real EOA traders. Layers en orden de coste:
 * 1. Known contracts blacklist (instant)
 * 2. Vanity heuristics (instant)
 * 3. eth_getCode (Ankr/RPC, fail-safe) — drops contracts
 * 4. Arkham label — drops CEX/Bridge/MEV/DEX/MarketMaker/etc (mantiene KOL/individual)
 * 5. Tx count (Moralis stats) — drops MEV/arb bots con stats extremas
 */
export async function filterEoaTraders(
  addresses: string[],
  chain: string
): Promise<{ kept: string[]; filtered: number }> {
  const { resolveArkhamLabel } = await import("./arkham");

  // Pass 1+2: cheap filters
  const candidates = addresses.filter((a) => {
    const lower = a.toLowerCase();
    if (KNOWN_CONTRACTS[lower]) return false;
    if (looksLikeVanityContract(a)) return false;
    return true;
  });

  // Pass 3: getCode
  const codeResults = await Promise.all(
    candidates.map((a) => isContract(a, chain).then((isC) => ({ addr: a, isC })))
  );
  const eoas = codeResults.filter((r) => !r.isC).map((r) => r.addr);

  // Pass 4: Arkham — descarta tipos no-humanos (preserva KOLs e individuales)
  const arkhamResults = await Promise.all(
    eoas.map(async (a) => {
      const lbl = await resolveArkhamLabel(a, chain).catch(() => null);
      const drop = !!(lbl?.funderType && NON_HUMAN_ARKHAM_TYPES.has(lbl.funderType));
      return { addr: a, drop };
    })
  );
  const afterArkham = arkhamResults.filter((r) => !r.drop).map((r) => r.addr);

  // Pass 5: activity check — drop bots / relays con stats extremas
  const activities = await Promise.all(
    afterArkham.map((a) => getWalletActivity(a, chain).then((act) => ({ addr: a, act })))
  );
  const kept = activities.filter((r) => !looksLikeBot(r.act)).map((r) => r.addr);

  return { kept, filtered: addresses.length - kept.length };
}
