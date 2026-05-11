import {
  getTransferLogs,
  parseTransfer,
  getNativeBalance,
  getBlockNumber,
  getContractDeployBlock,
  ethCall,
  RawLog,
} from "./ankr";
import { resolveArkhamLabel } from "./arkham";
import { lookupKnownFunder, KnownFunder } from "./funder_lists";
import { cacheGet, cacheSet } from "../utils/cache";
import { config } from "../config";

// ─── Tipos públicos ──────────────────────────────────────────────────────────

export interface TokenBuyStats {
  /** Tokens netos comprados (incluye sells restados) */
  netBought: number;
  /** Tokens totales que han entrado a la wallet (sin restar sells) */
  totalBought: number;
  /** Tokens que han salido */
  totalSold: number;
  /** Cantidad actual en la wallet */
  currentBalance: number;
  /** % del supply respecto al total comprado */
  pctSupplyBought: number;
  /** ETH/native gastado aproximado (sumando los swaps detectados) */
  nativeSpent: number;
  /** Marketcap aproximado en el bloque de la PRIMERA compra de esta wallet */
  marketCapAtEntry: number;
  /** Estado: 'holding' | 'partial' | 'sold_all' | 'never_bought' */
  status: "holding" | "partial" | "sold_all" | "never_bought";
  /** Bloque de la primera compra */
  firstBuyBlock: number;
}

export interface WalletFunding {
  source: "CEX" | "BRIDGE" | "MIXER" | "SWAP_SERVICE" | "KOL" | "DEX" | "MEV" | "OTHER" | "UNKNOWN";
  label: string | null;
  funderAddress: string | null;
}

// ─── Constantes ──────────────────────────────────────────────────────────────

const WETH: Record<string, string> = {
  eth:      "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  bsc:      "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",   // WBNB
  base:     "0x4200000000000000000000000000000000000006",
  arbitrum: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
};

// Uniswap V2 Factory para detectar pair (no usado por defecto, mantenido por compatibilidad)
const V2_FACTORY: Record<string, string> = {
  eth:      "0x5c69bee701ef814a2b6a3edd4b1652cb9cc5aa6f",
  bsc:      "0xca143ce32fe78f1f7019d7d551a6402fc5350c73",   // Pancake V2
  base:     "0x8909dc15e40173ff4699343b6eb8132c65e18ec6",   // Uniswap V2 Base
  arbitrum: "0xf1d7cc64fb4452f05c498126312ebe29f30fbcf9",
};

// Función `getReserves()` Uniswap V2 selector: 0x0902f1ac
const V2_GET_RESERVES = "0x0902f1ac";
// Uniswap V3 `slot0()` selector: 0x3850c7bd
const V3_SLOT0 = "0x3850c7bd";
// `token0()` selector: 0x0dfe1681
const SEL_TOKEN0 = "0x0dfe1681";
// `decimals()` selector: 0x313ce567
const SEL_DECIMALS = "0x313ce567";
// `totalSupply()` selector: 0x18160ddd
const SEL_TOTAL_SUPPLY = "0x18160ddd";

// ─── Detección de pairs (V2 + V3) ────────────────────────────────────────────
// El logs Transfer del token reveal qué addresses son pairs: las que reciben
// muchos transfers heterogéneos y emiten también. Más simple: cualquier address
// que sea CONTRACT y aparezca como `from` en buys de ETH-pair. La estrategia
// pragmática: identificar dirección del par a través de actividad — cualquier
// address que tiene volumen alto BIDIRECCIONAL.

interface ParsedTransfer {
  from: string;
  to: string;
  value: bigint;
  blockNumber: number;
}

function parseAll(logs: RawLog[]): ParsedTransfer[] {
  return logs.map((l) => {
    const p = parseTransfer(l);
    return { ...p, blockNumber: parseInt(l.blockNumber, 16) };
  });
}

// Detecta pairs por actividad: una address es pair si aparece como `from` Y `to`
// en transferencias del token con volumen significativo.
function detectPairs(transfers: ParsedTransfer[]): Set<string> {
  const fromCount = new Map<string, number>();
  const toCount = new Map<string, number>();
  for (const t of transfers) {
    fromCount.set(t.from, (fromCount.get(t.from) || 0) + 1);
    toCount.set(t.to, (toCount.get(t.to) || 0) + 1);
  }
  const pairs = new Set<string>();
  for (const [addr, fc] of fromCount) {
    const tc = toCount.get(addr) || 0;
    if (fc >= 5 && tc >= 5) pairs.add(addr);
  }
  return pairs;
}

// ─── Token metadata via Ankr (cached) ────────────────────────────────────────

export async function getTokenDecimals(tokenAddress: string, chain: string): Promise<number> {
  const key = `dec:${chain}:${tokenAddress.toLowerCase()}`;
  const cached = cacheGet<number>(key);
  if (cached !== null && cached !== undefined) return cached;
  const hex = await ethCall(chain, tokenAddress, SEL_DECIMALS);
  const dec = hex ? parseInt(hex, 16) : 18;
  cacheSet(key, dec, 24 * 60 * 60 * 1000);
  return dec;
}

export async function getTotalSupply(tokenAddress: string, chain: string): Promise<bigint> {
  const key = `supply:${chain}:${tokenAddress.toLowerCase()}`;
  const cached = cacheGet<string>(key);
  if (cached) return BigInt(cached);
  const hex = await ethCall(chain, tokenAddress, SEL_TOTAL_SUPPLY);
  const supply = hex ? BigInt(hex) : 0n;
  cacheSet(key, supply.toString(), 5 * 60 * 1000);
  return supply;
}

// ─── Price-at-block: lee reservas V2 (o slot0 V3) en el bloque dado ──────────

interface PoolPrice {
  /** Tokens del CA por 1 WETH/WBNB (en unidades humanas) */
  tokensPerNative: number;
  /** Sqrt-priceX96 (V3) o reservas (V2) en bruto */
  raw: any;
}

async function readV2Reserves(
  pairAddr: string,
  chain: string,
  blockNumber: number
): Promise<{ r0: bigint; r1: bigint } | null> {
  const hex = await ethCall(chain, pairAddr, V2_GET_RESERVES, blockNumber);
  if (!hex || hex === "0x") return null;
  // getReserves returns (uint112,uint112,uint32) → 3 × 32 bytes
  const clean = hex.replace(/^0x/, "");
  if (clean.length < 192) return null;
  const r0 = BigInt("0x" + clean.slice(0, 64));
  const r1 = BigInt("0x" + clean.slice(64, 128));
  return { r0, r1 };
}

async function readV3Slot0(
  pairAddr: string,
  chain: string,
  blockNumber: number
): Promise<{ sqrtPriceX96: bigint } | null> {
  const hex = await ethCall(chain, pairAddr, V3_SLOT0, blockNumber);
  if (!hex || hex === "0x") return null;
  const clean = hex.replace(/^0x/, "");
  if (clean.length < 64) return null;
  const sqrt = BigInt("0x" + clean.slice(0, 64));
  return { sqrtPriceX96: sqrt };
}

async function getToken0(pairAddr: string, chain: string): Promise<string | null> {
  const key = `t0:${chain}:${pairAddr.toLowerCase()}`;
  const cached = cacheGet<string>(key);
  if (cached) return cached;
  const hex = await ethCall(chain, pairAddr, SEL_TOKEN0);
  if (!hex || hex === "0x") return null;
  const addr = "0x" + hex.slice(-40);
  cacheSet(key, addr.toLowerCase(), 24 * 60 * 60 * 1000);
  return addr.toLowerCase();
}

/**
 * Devuelve el precio (tokens por 1 native) del token en un pair concreto,
 * leyendo estado al bloque dado. Intenta V2 primero, V3 después.
 */
async function getTokensPerNativeAtBlock(
  pairAddr: string,
  tokenAddress: string,
  tokenDecimals: number,
  chain: string,
  blockNumber: number
): Promise<number> {
  const wethAddr = WETH[chain];
  const token0 = await getToken0(pairAddr, chain);
  if (!token0) return 0;
  const tokenIsToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();

  // Try V2
  const v2 = await readV2Reserves(pairAddr, chain, blockNumber);
  if (v2) {
    const tokenReserve = tokenIsToken0 ? v2.r0 : v2.r1;
    const nativeReserve = tokenIsToken0 ? v2.r1 : v2.r0;
    if (tokenReserve === 0n || nativeReserve === 0n) return 0;
    // tokens per native = tokenReserve / nativeReserve, adjusted for decimals
    const tokenH = Number(tokenReserve) / 10 ** tokenDecimals;
    const nativeH = Number(nativeReserve) / 10 ** 18;
    if (nativeH === 0) return 0;
    return tokenH / nativeH;
  }

  // Try V3
  const v3 = await readV3Slot0(pairAddr, chain, blockNumber);
  if (v3) {
    // sqrtPriceX96 = sqrt(price) × 2^96 where price = token1/token0
    const sqrt = Number(v3.sqrtPriceX96);
    if (sqrt === 0) return 0;
    const Q96 = 2 ** 96;
    const priceToken1PerToken0 = (sqrt / Q96) ** 2;
    // If token = token0: native per token = priceToken1PerToken0 (assuming token1=WETH)
    // We want tokens per native:
    let tokensPerNative: number;
    if (tokenIsToken0) {
      // 1 token0 = priceToken1PerToken0 token1; if token1 = native:
      // 1 native = 1/priceToken1PerToken0 token
      tokensPerNative = 1 / priceToken1PerToken0;
    } else {
      // token = token1, native = token0
      // 1 native (token0) = priceToken1PerToken0 token
      tokensPerNative = priceToken1PerToken0;
    }
    // Decimals adjustment: price ratio is in raw units. Need decimal correction.
    const decimalAdj = 10 ** (tokenDecimals - 18);
    return tokensPerNative * decimalAdj;
  }

  return 0;
}

// ─── Análisis principal ──────────────────────────────────────────────────────

export interface TokenWalletAnalysis {
  /** Por wallet (lower-case) */
  perWallet: Map<string, TokenBuyStats>;
  /** Pairs detectados del token */
  pairs: Set<string>;
  /** Bloque actual al hacer el análisis */
  currentBlock: number;
}

/**
 * Para UN token: descarga TODOS los Transfer logs desde el deploy y calcula
 * stats por cada wallet del set.
 */
export async function analyzeTokenForWallets(
  tokenAddress: string,
  chain: string,
  wallets: string[]
): Promise<TokenWalletAnalysis> {
  const walletSet = new Set(wallets.map((w) => w.toLowerCase()));
  const [decimals, totalSupplyRaw, currentBlock, deployBlock] = await Promise.all([
    getTokenDecimals(tokenAddress, chain),
    getTotalSupply(tokenAddress, chain),
    getBlockNumber(chain),
    getContractDeployBlock(tokenAddress, chain),
  ]);
  const totalSupply = Number(totalSupplyRaw) / 10 ** decimals;

  const logs = await getTransferLogs(tokenAddress, chain, deployBlock, currentBlock);
  const transfers = parseAll(logs);
  const pairs = detectPairs(transfers);

  // Por wallet, acumular IN (compras desde pair) y OUT (sells hacia pair)
  // Y también IN/OUT generales para detectar transfers fuera del swap
  interface Agg {
    bought: bigint;     // tokens recibidos desde un pair
    sold: bigint;       // tokens enviados a un pair
    receivedOther: bigint; // tokens recibidos de no-pair (transfer airdrop)
    sentOther: bigint;     // tokens enviados a no-pair
    firstBuyBlock: number;
    firstBuyPair: string | null;
  }

  const agg = new Map<string, Agg>();
  function getAgg(w: string): Agg {
    let a = agg.get(w);
    if (!a) {
      a = { bought: 0n, sold: 0n, receivedOther: 0n, sentOther: 0n, firstBuyBlock: 0, firstBuyPair: null };
      agg.set(w, a);
    }
    return a;
  }

  for (const t of transfers) {
    const toIn = walletSet.has(t.to);
    const fromIn = walletSet.has(t.from);
    if (toIn) {
      const a = getAgg(t.to);
      if (pairs.has(t.from)) {
        a.bought += t.value;
        if (a.firstBuyBlock === 0 || t.blockNumber < a.firstBuyBlock) {
          a.firstBuyBlock = t.blockNumber;
          a.firstBuyPair = t.from;
        }
      } else {
        a.receivedOther += t.value;
      }
    }
    if (fromIn) {
      const a = getAgg(t.from);
      if (pairs.has(t.to)) {
        a.sold += t.value;
      } else {
        a.sentOther += t.value;
      }
    }
  }

  // Compute per-wallet stats
  const perWallet = new Map<string, TokenBuyStats>();
  const priceCache = new Map<string, number>(); // blockNumber:pair → tokensPerNative

  for (const wallet of walletSet) {
    const a = agg.get(wallet);
    if (!a) {
      perWallet.set(wallet, {
        netBought: 0, totalBought: 0, totalSold: 0, currentBalance: 0,
        pctSupplyBought: 0, nativeSpent: 0, marketCapAtEntry: 0,
        status: "never_bought", firstBuyBlock: 0,
      });
      continue;
    }
    const totalBoughtRaw = a.bought + a.receivedOther; // count both swap buys and transfers in
    const totalSoldRaw = a.sold + a.sentOther;
    const currentRaw = totalBoughtRaw > totalSoldRaw ? totalBoughtRaw - totalSoldRaw : 0n;

    const totalBought = Number(totalBoughtRaw) / 10 ** decimals;
    const totalSold = Number(totalSoldRaw) / 10 ** decimals;
    const currentBalance = Number(currentRaw) / 10 ** decimals;
    const pctSupplyBought = totalSupply > 0 ? (totalBought / totalSupply) * 100 : 0;

    // Price at first buy
    let mcAtEntry = 0;
    let nativeSpent = 0;
    if (a.firstBuyBlock > 0 && a.firstBuyPair) {
      const priceKey = `${a.firstBuyBlock}:${a.firstBuyPair}`;
      let tokensPerNative = priceCache.get(priceKey);
      if (tokensPerNative === undefined) {
        tokensPerNative = await getTokensPerNativeAtBlock(a.firstBuyPair, tokenAddress, decimals, chain, a.firstBuyBlock);
        priceCache.set(priceKey, tokensPerNative);
      }
      if (tokensPerNative > 0) {
        // price per token (native) = 1 / tokensPerNative
        const pricePerTokenNative = 1 / tokensPerNative;
        nativeSpent = totalBought * pricePerTokenNative; // approx, asumiendo precio constante
        mcAtEntry = totalSupply * pricePerTokenNative;   // en unidades native
      }
    }

    // Status
    let status: TokenBuyStats["status"];
    if (totalBoughtRaw === 0n) status = "never_bought";
    else if (currentBalance < totalBought * 0.05) status = "sold_all";
    else if (currentBalance < totalBought * 0.95) status = "partial";
    else status = "holding";

    perWallet.set(wallet, {
      netBought: totalBought - totalSold,
      totalBought,
      totalSold,
      currentBalance,
      pctSupplyBought,
      nativeSpent,
      marketCapAtEntry: mcAtEntry,
      status,
      firstBuyBlock: a.firstBuyBlock,
    });
  }

  return { perWallet, pairs, currentBlock };
}

// ─── Funding detection ───────────────────────────────────────────────────────
// Estrategia:
//  1. Sacar todos los Transfer logs de WETH/WBNB hacia la wallet
//     (no podemos sacar tx normales con eth_getLogs → solo native via WETH wrap)
//  2. Esto NO captura tx de ETH puro entre EOAs. Para eso necesitaríamos
//     scanning de blocks (caro) o un endpoint dedicado.
//  Alternativa simple: usar Arkham para que nos diga el funder si es público.
//
// Implementación pragmática: si Arkham label dice algo → usarlo. Sino, marcar UNKNOWN.

export async function getWalletFunding(address: string, chain: string): Promise<WalletFunding> {
  // Layer 1: lookup en listas estáticas (de la propia wallet — raro pero posible si es un hot wallet conocido)
  const known = lookupKnownFunder(address);
  if (known) {
    return { source: known.type, label: known.label, funderAddress: null };
  }
  // Layer 2: Arkham label de la propia wallet
  const arkham = await resolveArkhamLabel(address, chain);
  if (arkham?.funderType) {
    return {
      source: (arkham.funderType as WalletFunding["source"]) || "OTHER",
      label: arkham.label,
      funderAddress: null,
    };
  }
  return { source: "UNKNOWN", label: null, funderAddress: null };
}

// ─── Native balance helper (reexport) ────────────────────────────────────────

export { getNativeBalance };
