import { cacheGet, cacheSet } from "../utils/cache";
import { config } from "../config";

// EVM RPC client — cascada de proveedores con fallback automático.
// Orden: Alchemy (primario, fiable para eth_getLogs) → dRPC → Nodereal →
//        Chainstack → BlockPi → Ankr → public RPC de último recurso.

function buildRpcList(chain: string): string[] {
  const list: string[] = [];

  // Alchemy
  if (chain === "eth" && config.alchemyEthKey) {
    list.push(`https://eth-mainnet.g.alchemy.com/v2/${config.alchemyEthKey}`);
  }
  if (chain === "bsc" && config.alchemyBscKey) {
    list.push(`https://bnb-mainnet.g.alchemy.com/v2/${config.alchemyBscKey}`);
  }
  if (chain === "base" && config.alchemyBaseKey) {
    list.push(`https://base-mainnet.g.alchemy.com/v2/${config.alchemyBaseKey}`);
  }

  // dRPC (soporta eth, bsc, base, arbitrum)
  if (config.drpcKey) {
    const drpcChain: Record<string, string> = {
      eth: "ethereum", bsc: "bsc", base: "base", arbitrum: "arbitrum",
    };
    if (drpcChain[chain]) {
      list.push(`https://lb.drpc.org/ogrpc?network=${drpcChain[chain]}&dkey=${config.drpcKey}`);
    }
  }

  // Nodereal (ETH only)
  if (chain === "eth" && config.noderealKey) {
    list.push(`https://eth-mainnet.nodereal.io/v1/${config.noderealKey}`);
  }

  // Chainstack
  if (chain === "eth" && config.chainstackEthUrl) {
    list.push(config.chainstackEthUrl);
  }

  // BlockPi
  if (chain === "eth" && config.blockpiEthUrl) {
    list.push(config.blockpiEthUrl);
  }

  // Ankr (con key si existe, sin key como fallback)
  if (config.ankrApiKey) {
    const ankrChain: Record<string, string> = {
      eth: "eth", bsc: "bsc", base: "base", arbitrum: "arbitrum",
    };
    if (ankrChain[chain]) {
      list.push(`https://rpc.ankr.com/${ankrChain[chain]}/${config.ankrApiKey}`);
    }
  }

  // Public RPCs de último recurso
  const publicRpcs: Record<string, string> = {
    eth:      "https://ethereum.publicnode.com",
    bsc:      "https://bsc-dataseed.binance.org",
    base:     "https://mainnet.base.org",
    arbitrum: "https://arb1.arbitrum.io/rpc",
  };
  if (publicRpcs[chain]) list.push(publicRpcs[chain]);

  return list;
}

// Intenta en cascada hasta obtener respuesta. Retorna [result, null] o [null, lastError].
async function rpcCascade<T = any>(
  chain: string,
  method: string,
  params: any[],
  timeoutMs = 12_000
): Promise<T | null> {
  const rpcs = buildRpcList(chain);
  let lastErr = "";
  for (const url of rpcs) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
        continue;
      }
      const j = (await res.json()) as any;
      if (j.error) {
        lastErr = j.error.message || JSON.stringify(j.error);
        // Si es error de "range too large" o similar, NO continuar a otro proveedor
        // — el caller maneja el retry con chunk más pequeño.
        const msg = lastErr.toLowerCase();
        if (msg.includes("too large") || msg.includes("response size") || msg.includes("limit exceeded")) {
          throw new RangeTooLargeError(lastErr);
        }
        continue;
      }
      return j.result as T;
    } catch (e: any) {
      if (e instanceof RangeTooLargeError) throw e;
      lastErr = e?.message || String(e);
    }
  }
  console.log(`[rpc:${chain}] ${method} all RPCs failed. Last: ${lastErr}`);
  return null;
}

class RangeTooLargeError extends Error {
  constructor(msg: string) { super(msg); this.name = "RangeTooLargeError"; }
}

// ─── eth_getBalance ─────────────────────────────────────────────────────────

export async function getNativeBalance(address: string, chain: string): Promise<number> {
  const key = `rpc:bal:${chain}:${address.toLowerCase()}`;
  const cached = cacheGet<number>(key);
  if (cached !== null && cached !== undefined) return cached;
  const hex = await rpcCascade<string>(chain, "eth_getBalance", [address, "latest"]);
  if (!hex) return 0;
  const eth = Number(BigInt(hex)) / 1e18;
  cacheSet(key, eth, config.cacheTtl);
  return eth;
}

// ─── eth_blockNumber ────────────────────────────────────────────────────────

export async function getBlockNumber(chain: string): Promise<number> {
  const hex = await rpcCascade<string>(chain, "eth_blockNumber", []);
  if (!hex) return 0;
  return parseInt(hex, 16);
}

// ─── eth_getLogs paginado por rango de bloques ──────────────────────────────

export interface RawLog {
  address: string;
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
  logIndex: string;
}

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export async function getTransferLogs(
  tokenAddress: string,
  chain: string,
  fromBlock: number,
  toBlock: number,
  initialChunk = 2000
): Promise<RawLog[]> {
  const key = `rpc:logs:${chain}:${tokenAddress.toLowerCase()}:${fromBlock}-${toBlock}`;
  const cached = cacheGet<RawLog[]>(key);
  if (cached) return cached;

  async function fetchRange(from: number, to: number, chunk: number): Promise<RawLog[]> {
    const out: RawLog[] = [];
    let cursor = from;
    while (cursor <= to) {
      const end = Math.min(cursor + chunk - 1, to);
      try {
        const rpcs = buildRpcList(chain);
        let logs: RawLog[] | null = null;
        let gotRangeTooLarge = false;
        for (const url of rpcs) {
          try {
            const res = await fetch(url, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getLogs", params: [{
                address: tokenAddress,
                topics: [TRANSFER_TOPIC],
                fromBlock: "0x" + cursor.toString(16),
                toBlock: "0x" + end.toString(16),
              }] }),
              signal: AbortSignal.timeout(20_000),
            });
            if (!res.ok) continue;
            const j = (await res.json()) as any;
            if (j.error) {
              const msg = (j.error.message || "").toLowerCase();
              if (chunk > 100 && (msg.includes("too large") || msg.includes("response size") || msg.includes("limit exceeded") || msg.includes("eth_getlogs"))) {
                gotRangeTooLarge = true;
                break;
              }
              console.log(`[rpc:${chain} getLogs] ${cursor}-${end} err: ${j.error.message}`);
              continue;
            }
            if (Array.isArray(j.result)) {
              logs = j.result;
              break;
            }
          } catch (e: any) {
            // timeout / network error — try next RPC
          }
        }
        if (gotRangeTooLarge) {
          const half = Math.floor(chunk / 2);
          const sub = await fetchRange(cursor, end, half);
          out.push(...sub);
          cursor = end + 1;
          continue;
        }
        if (logs) out.push(...logs);
      } catch (e: any) {
        console.log(`[rpc:${chain} getLogs] ${cursor}-${end} outer err: ${e?.message}`);
      }
      cursor = end + 1;
    }
    return out;
  }

  // Alchemy soporta hasta 2000 blocks por llamada por defecto; dRPC/Chainstack hasta 10000.
  // Empezamos con 2000 y el backoff lo sube si hay error.
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

// Buyers de un token = unique `to` addresses en Transfer logs desde pairCreatedAt.
export async function getTokenBuyersFromLogs(
  tokenAddress: string,
  chain: string,
  fromDate?: Date,
  explicitFromBlock?: number
): Promise<Set<string>> {
  const dateKey = explicitFromBlock != null
    ? `b${explicitFromBlock}`
    : fromDate ? fromDate.toISOString().slice(0, 10) : "all";
  const cacheKey = `rpc:buyers:${chain}:${tokenAddress.toLowerCase()}:${dateKey}`;
  const cached = cacheGet<string[]>(cacheKey);
  if (cached) return new Set(cached);

  const head = await getBlockNumber(chain);
  if (head === 0) {
    console.log(`[rpc:${chain}] getBlockNumber returned 0 — all RPCs down?`);
    return new Set();
  }

  let fromBlock: number;
  if (explicitFromBlock != null) {
    fromBlock = explicitFromBlock;
  } else if (fromDate) {
    fromBlock = timestampToBlock(Math.floor(fromDate.getTime() / 1000), head, chain);
  } else {
    // Sin pista — 90 días de cobertura máxima
    const NINETY_DAYS = 90 * 24 * 3600;
    fromBlock = timestampToBlock(Math.floor(Date.now() / 1000) - NINETY_DAYS, head, chain);
  }

  console.log(`[rpc:${chain}] getLogs ${tokenAddress.slice(0, 10)} blocks ${fromBlock}→${head} (${(head - fromBlock).toLocaleString()} blocks)`);
  const logs = await getTransferLogs(tokenAddress, chain, fromBlock, head);
  console.log(`[rpc:${chain}] getLogs ${tokenAddress.slice(0, 10)} got ${logs.length} logs`);

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

export async function ethCall(
  chain: string,
  to: string,
  data: string,
  blockNumber?: number
): Promise<string | null> {
  const block = blockNumber ? "0x" + blockNumber.toString(16) : "latest";
  return rpcCascade<string>(chain, "eth_call", [{ to, data }, block]);
}

// ─── Block timestamp lookup ─────────────────────────────────────────────────

export async function getBlockTimestamp(chain: string, blockNumber: number): Promise<number> {
  const key = `rpc:blockts:${chain}:${blockNumber}`;
  const cached = cacheGet<number>(key);
  if (cached !== null && cached !== undefined) return cached;
  const hex = "0x" + blockNumber.toString(16);
  const block = await rpcCascade<any>(chain, "eth_getBlockByNumber", [hex, false]);
  if (!block?.timestamp) return 0;
  const ts = parseInt(block.timestamp, 16);
  cacheSet(key, ts, 24 * 60 * 60 * 1000);
  return ts;
}

// ─── eth_getCode (para isContract) ──────────────────────────────────────────

export async function getCode(address: string, chain: string): Promise<string | null> {
  return rpcCascade<string>(chain, "eth_getCode", [address, "latest"]);
}

// ─── Find token deployment block (binary search) ────────────────────────────

export async function getContractDeployBlock(
  address: string,
  chain: string,
  currentBlock?: number
): Promise<number> {
  const key = `rpc:deploy:${chain}:${address.toLowerCase()}`;
  const cached = cacheGet<number>(key);
  if (cached !== null && cached !== undefined) return cached;

  const head = currentBlock || (await getBlockNumber(chain));
  let lo = 0;
  let hi = head;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const code = await rpcCascade<string>(chain, "eth_getCode", [address, "0x" + mid.toString(16)]);
    if (code && code !== "0x" && code !== "0x0") {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  cacheSet(key, lo, 7 * 24 * 60 * 60 * 1000);
  return lo;
}
