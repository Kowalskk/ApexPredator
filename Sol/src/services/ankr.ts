import { cacheGet, cacheSet } from "../utils/cache";
import { config } from "../config";

// Ankr Premium HTTP — solo métodos JSON-RPC estándar.
// Pricing: pago por crédito, sin rate limit duro como free tier.

const ANKR_URLS: Record<string, string> = {
  eth:      `https://rpc.ankr.com/eth/${config.ankrApiKey}`,
  bsc:      `https://rpc.ankr.com/bsc/${config.ankrApiKey}`,
  base:     `https://rpc.ankr.com/base/${config.ankrApiKey}`,
  arbitrum: `https://rpc.ankr.com/arbitrum/${config.ankrApiKey}`,
};

// Public RPCs de fallback si Ankr key falta o falla
const PUBLIC_RPCS: Record<string, string> = {
  eth:      "https://eth.llamarpc.com",
  bsc:      "https://bsc-dataseed.binance.org",
  base:     "https://mainnet.base.org",
  arbitrum: "https://arb1.arbitrum.io/rpc",
};

function rpcUrl(chain: string): string {
  if (config.ankrApiKey && ANKR_URLS[chain]) return ANKR_URLS[chain];
  return PUBLIC_RPCS[chain] || PUBLIC_RPCS.eth;
}

async function rpcCall<T = any>(chain: string, method: string, params: any[]): Promise<T | null> {
  try {
    const res = await fetch(rpcUrl(chain), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as any;
    if (j.error) return null;
    return j.result as T;
  } catch {
    return null;
  }
}

// ─── eth_getBalance ─────────────────────────────────────────────────────────

export async function getNativeBalance(address: string, chain: string): Promise<number> {
  const key = `ankr:bal:${chain}:${address.toLowerCase()}`;
  const cached = cacheGet<number>(key);
  if (cached !== null && cached !== undefined) return cached;
  const hex = await rpcCall<string>(chain, "eth_getBalance", [address, "latest"]);
  if (!hex) return 0;
  const wei = BigInt(hex);
  const eth = Number(wei) / 1e18;
  cacheSet(key, eth, config.cacheTtl);
  return eth;
}

// ─── eth_blockNumber ────────────────────────────────────────────────────────

export async function getBlockNumber(chain: string): Promise<number> {
  const hex = await rpcCall<string>(chain, "eth_blockNumber", []);
  return hex ? parseInt(hex, 16) : 0;
}

// ─── eth_getLogs paginado por rango de bloques ──────────────────────────────
// Ankr soporta `eth_getLogs` con `fromBlock`/`toBlock`. Si el rango es grande,
// puede devolver error de "result too large" — chunkeamos en ventanas.

export interface RawLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
}

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// Versión robusta: si Ankr devuelve error "Block range is too large" o similar,
// reduce el chunk a la mitad y reintenta. Empieza con chunks de 2000 (probado).
export async function getTransferLogs(
  tokenAddress: string,
  chain: string,
  fromBlock: number,
  toBlock: number,
  initialChunk = 2000
): Promise<RawLog[]> {
  const key = `ankr:logs:${chain}:${tokenAddress.toLowerCase()}:${fromBlock}-${toBlock}`;
  const cached = cacheGet<RawLog[]>(key);
  if (cached) return cached;

  async function fetchRange(from: number, to: number, chunk: number): Promise<RawLog[]> {
    const out: RawLog[] = [];
    let cursor = from;
    while (cursor <= to) {
      const end = Math.min(cursor + chunk - 1, to);
      // rpcCall returns null on any error (including "range too large")
      let logs: RawLog[] | null = null;
      try {
        const res = await fetch(rpcUrl(chain), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [{
            address: tokenAddress, topics: [TRANSFER_TOPIC],
            fromBlock: "0x" + cursor.toString(16), toBlock: "0x" + end.toString(16),
          }] }),
          signal: AbortSignal.timeout(20_000),
        });
        const j = (await res.json()) as any;
        if (j.error) {
          const msg = (j.error.message || "").toLowerCase();
          // Retry con chunk más pequeño si es problema de tamaño
          if (chunk > 100 && (msg.includes("too large") || msg.includes("limit") || msg.includes("eth_getlogs"))) {
            const half = Math.floor(chunk / 2);
            const sub = await fetchRange(cursor, end, half);
            out.push(...sub);
            cursor = end + 1;
            continue;
          }
          // Otro error: log y skip
          console.log(`[ankr getLogs] ${cursor}-${end} err: ${j.error.message}`);
        } else if (Array.isArray(j.result)) {
          logs = j.result;
        }
      } catch (e: any) {
        console.log(`[ankr getLogs] ${cursor}-${end} fetch err: ${e?.message}`);
      }
      if (logs) out.push(...logs);
      cursor = end + 1;
    }
    return out;
  }

  const allLogs = await fetchRange(fromBlock, toBlock, initialChunk);
  cacheSet(key, allLogs, config.cacheTtl);
  return allLogs;
}

// Traduce un timestamp UNIX a un bloque aproximado para una chain dada.
const SECS_PER_BLOCK: Record<string, number> = { eth: 12, bsc: 3, base: 2, arbitrum: 0.25 };
export function timestampToBlock(timestamp: number, head: number, chain: string): number {
  const spb = SECS_PER_BLOCK[chain] || 12;
  const secsAgo = Math.floor((Date.now() / 1000) - timestamp);
  const blocksAgo = Math.floor(secsAgo / spb);
  return Math.max(0, head - blocksAgo);
}

// Buyers de un token = unique `to` addresses en los Transfer logs.
// Acepta `fromBlock` explícito (recomendado, ej. pairCreatedAt convertido) y/o `fromDate`.
export async function getTokenBuyersFromLogs(
  tokenAddress: string,
  chain: string,
  fromDate?: Date,
  explicitFromBlock?: number
): Promise<Set<string>> {
  const dateKey = explicitFromBlock != null
    ? `b${explicitFromBlock}`
    : fromDate ? fromDate.toISOString().slice(0, 10) : "all";
  const cacheKey = `ankr:buyers:${chain}:${tokenAddress.toLowerCase()}:${dateKey}`;
  const cached = cacheGet<string[]>(cacheKey);
  if (cached) return new Set(cached);

  const head = await getBlockNumber(chain);
  let fromBlock: number;
  if (explicitFromBlock != null) {
    fromBlock = explicitFromBlock;
  } else if (fromDate) {
    fromBlock = timestampToBlock(Math.floor(fromDate.getTime() / 1000), head, chain);
  } else {
    // Sin pista — caemos al binary search (caro). Cap a 7 días para no quemarse.
    const SEVEN_DAYS = 7 * 24 * 3600;
    fromBlock = timestampToBlock(Math.floor(Date.now() / 1000) - SEVEN_DAYS, head, chain);
  }

  const logs = await getTransferLogs(tokenAddress, chain, fromBlock, head);
  const buyers = new Set<string>();
  for (const log of logs) {
    if (log.topics.length < 3) continue;
    const to = "0x" + log.topics[2].slice(-40);
    buyers.add(to.toLowerCase());
  }
  cacheSet(cacheKey, Array.from(buyers), config.cacheTtl);
  return buyers;
}

// Parse Transfer(from, to, value) log
export function parseTransfer(log: RawLog): { from: string; to: string; value: bigint } {
  const from = "0x" + log.topics[1].slice(-40);
  const to = "0x" + log.topics[2].slice(-40);
  const value = BigInt(log.data === "0x" ? "0x0" : log.data);
  return { from: from.toLowerCase(), to: to.toLowerCase(), value };
}

// ─── eth_call con bloque histórico ──────────────────────────────────────────
// Para leer reservas de pares Uniswap V2 / slot0 V3 al bloque exacto de compra.

export async function ethCall(
  chain: string,
  to: string,
  data: string,
  blockNumber?: number
): Promise<string | null> {
  const block = blockNumber ? "0x" + blockNumber.toString(16) : "latest";
  return rpcCall<string>(chain, "eth_call", [{ to, data }, block]);
}

// ─── Block timestamp lookup ─────────────────────────────────────────────────

export async function getBlockTimestamp(chain: string, blockNumber: number): Promise<number> {
  const key = `ankr:blockts:${chain}:${blockNumber}`;
  const cached = cacheGet<number>(key);
  if (cached !== null && cached !== undefined) return cached;
  const hex = "0x" + blockNumber.toString(16);
  const block = await rpcCall<any>(chain, "eth_getBlockByNumber", [hex, false]);
  if (!block?.timestamp) return 0;
  const ts = parseInt(block.timestamp, 16);
  cacheSet(key, ts, 24 * 60 * 60 * 1000);
  return ts;
}

// ─── Find token deployment block (binary search via getCode) ────────────────
// Necesario para no escanear desde block 0. Cache permanente (no cambia).

export async function getContractDeployBlock(
  address: string,
  chain: string,
  currentBlock?: number
): Promise<number> {
  const key = `ankr:deploy:${chain}:${address.toLowerCase()}`;
  const cached = cacheGet<number>(key);
  if (cached !== null && cached !== undefined) return cached;

  const head = currentBlock || (await getBlockNumber(chain));
  let lo = 0;
  let hi = head;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const code = await rpcCall<string>(chain, "eth_getCode", [address, "0x" + mid.toString(16)]);
    if (code && code !== "0x" && code !== "0x0") {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  cacheSet(key, lo, 7 * 24 * 60 * 60 * 1000); // 7 días
  return lo;
}
