import http from "http";
import { getTokenInfo, detectEvmChain } from "./services/dexscreener";
import { getEvmTopHolders } from "./services/moralis";
import { getTokenBuyersFromLogs, getBlockNumber, timestampToBlock, getNativeBalance } from "./services/ankr";
import { filterEoaTraders } from "./services/evm_filters";
import { analyzeTokenForWallets, getWalletFunding } from "./services/wallet_analysis";
import { getNativePriceUsd } from "./services/coingecko";

export const API_PORT = 3001;
const API_SECRET = process.env.API_SECRET || "apex2026";

function json(res: http.ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  });
  res.end(body);
}

async function readBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => { data += chunk; });
    req.on("end", () => {
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
    req.on("error", reject);
  });
}

async function handleKol(body: any): Promise<object> {
  const tokens: string[] = (body.tokens || []).filter((t: string) => /^0x[a-fA-F0-9]{40}$/.test(t)).slice(0, 5);
  if (tokens.length < 2) throw new Error("Se necesitan al menos 2 tokens EVM válidos");

  const fromDate: Date | undefined = body.fromDate ? new Date(body.fromDate) : undefined;

  const tokenInfos = await Promise.all(tokens.map((m) => getTokenInfo(m).catch(() => null)));
  const chains = await Promise.all(tokens.map((m) => detectEvmChain(m).catch(() => "eth" as string)));

  const DAY_MS = 86_400_000;
  const now = Date.now();
  const oldestCreated = tokenInfos
    .map((t) => t?.pairCreatedAt || 0)
    .filter((ts) => ts > 0)
    .reduce((min, ts) => (ts < min ? ts : min), Infinity);
  const ageDays = oldestCreated === Infinity ? 0 : (now - oldestCreated) / DAY_MS;

  let resolvedFromDate: Date | undefined;
  let rangeLabel: string;
  if (fromDate) {
    resolvedFromDate = fromDate;
    rangeLabel = fromDate.toISOString().slice(0, 10);
  } else if (ageDays > 0 && ageDays <= 60) {
    resolvedFromDate = undefined;
    rangeLabel = `histórico completo (~${ageDays.toFixed(0)}d)`;
  } else {
    resolvedFromDate = new Date(now - 90 * DAY_MS);
    rangeLabel = "últimos 90 días";
  }

  const headByChain: Record<string, number> = {};
  for (const c of [...new Set(chains)]) {
    headByChain[c] = await getBlockNumber(c).catch(() => 0);
  }

  const buyerSets: Set<string>[] = [];
  const holderSets: any[][] = [];
  for (let i = 0; i < tokens.length; i++) {
    const m = tokens[i];
    const ti = tokenInfos[i];
    const tokenChain = chains[i];
    const head = headByChain[tokenChain] || 0;
    const pairCreated = ti?.pairCreatedAt ? Math.floor(ti.pairCreatedAt / 1000) : 0;
    const explicitFromBlock = pairCreated > 0 && head > 0
      ? Math.max(0, timestampToBlock(pairCreated, head, tokenChain) - 1000)
      : undefined;
    const [bs, hs] = await Promise.all([
      getTokenBuyersFromLogs(m, tokenChain, resolvedFromDate, explicitFromBlock).catch(() => new Set<string>()),
      getEvmTopHolders(m, tokenChain, 100).catch(() => []),
    ]);
    buyerSets.push(bs);
    holderSets.push(hs);
  }

  const holderMaps = holderSets.map((holders) => {
    const m = new Map<string, { pct: number; usd: number }>();
    for (const h of holders) {
      if (!h.ownerAddress) continue;
      m.set(h.ownerAddress.toLowerCase(), { pct: h.percentageRelativeToTotalSupply || 0, usd: h.usdValue || 0 });
    }
    return m;
  });

  const combinedSets = tokens.map((_, i) => {
    const combined = new Set(buyerSets[i]);
    for (const h of holderSets[i]) {
      if (h.ownerAddress) combined.add(h.ownerAddress.toLowerCase());
    }
    return combined;
  });

  const [first, ...rest] = combinedSets;
  const intersection = new Set<string>([...first].filter((addr) => rest.every((s) => s.has(addr))));

  const primaryChain = chains.reduce((acc, c) => { acc[c] = (acc[c] || 0) + 1; return acc; }, {} as Record<string, number>);
  const mainChain = Object.entries(primaryChain).sort((a, b) => b[1] - a[1])[0][0];

  const { kept } = await filterEoaTraders(Array.from(intersection), mainChain);
  const walletList = kept;

  if (walletList.length === 0) {
    return {
      wallets: [],
      meta: { tokens: tokens.length, chains: [...new Set(chains)], rangeLabel, intersection: intersection.size, kept: 0 },
    };
  }

  const symbols = tokens.map((_, i) => tokenInfos[i]?.symbol || `Token${i + 1}`);

  const uniqueChains = [...new Set(chains)];
  const [tokenAnalyses, balances, fundings, nativePricesArr] = await Promise.all([
    Promise.all(tokens.map((m, i) => analyzeTokenForWallets(m, chains[i], walletList).catch(() => null))),
    Promise.all(walletList.map((w) => getNativeBalance(w, mainChain).catch(() => 0))),
    Promise.all(walletList.map((w) => getWalletFunding(w, mainChain).catch(() => ({ source: "UNKNOWN" as const, label: null, funderAddress: null })))),
    Promise.all(uniqueChains.map((c) => getNativePriceUsd(c).catch(() => 0))),
  ]);

  const nativePriceByChain: Record<string, number> = {};
  uniqueChains.forEach((c, idx) => { nativePriceByChain[c] = (nativePricesArr as number[])[idx] || 0; });

  const NATIVE_SYMBOL: Record<string, string> = { eth: "ETH", bsc: "BNB", base: "ETH", arbitrum: "ETH" };

  const wallets = walletList.map((addr, idx) => {
    const perToken = tokens.map((_, i) => {
      const ta = (tokenAnalyses as any[])[i];
      const stats = ta ? ta.perWallet.get(addr) || null : null;
      const h = holderMaps[i].get(addr);
      const nativePrice = nativePriceByChain[chains[i]] || 0;
      return {
        symbol: symbols[i],
        chain: chains[i],
        nativeSym: NATIVE_SYMBOL[chains[i]] || "ETH",
        status: stats?.status || "never_bought",
        totalBought: stats?.totalBought || 0,
        nativeSpent: stats?.nativeSpent || 0,
        nativeSpentUsd: (stats?.nativeSpent || 0) * nativePrice,
        marketCapAtEntry: stats?.marketCapAtEntry || 0,
        marketCapAtEntryUsd: (stats?.marketCapAtEntry || 0) * nativePrice,
        pctSupplyBought: stats?.pctSupplyBought || 0,
        currentBalance: stats?.currentBalance || 0,
        holderPct: h?.pct || 0,
        holderUsd: h?.usd || 0,
      };
    });
    return {
      address: addr,
      nativeBalance: (balances as number[])[idx],
      nativeSym: NATIVE_SYMBOL[mainChain] || "ETH",
      nativeBalanceUsd: (balances as number[])[idx] * (nativePriceByChain[mainChain] || 0),
      funding: (fundings as any[])[idx],
      perToken,
    };
  });

  // Sort: holding first, then by pct supply bought
  wallets.sort((a, b) => {
    const aH = a.perToken.filter(p => p.status === "holding").length;
    const bH = b.perToken.filter(p => p.status === "holding").length;
    if (aH !== bH) return bH - aH;
    return b.perToken.reduce((s, p) => s + p.pctSupplyBought, 0) - a.perToken.reduce((s, p) => s + p.pctSupplyBought, 0);
  });

  return {
    wallets,
    meta: {
      tokens: tokens.length,
      symbols,
      chains: [...new Set(chains)],
      rangeLabel,
      intersection: intersection.size,
      kept: wallets.length,
    },
  };
}

export function startApiServer() {
  const server = http.createServer(async (req, res) => {
    // CORS preflight
    if (req.method === "OPTIONS") { json(res, 204, {}); return; }

    // Auth check (skip OPTIONS)
    const auth = req.headers["authorization"] || req.headers["x-api-key"] || "";
    if (auth !== `Bearer ${API_SECRET}` && auth !== API_SECRET) {
      json(res, 401, { error: "Unauthorized" });
      return;
    }

    const url = req.url?.split("?")[0];

    if (req.method === "GET" && url === "/health") {
      json(res, 200, { ok: true, ts: Date.now() });
      return;
    }

    if (req.method === "POST" && url === "/api/kol") {
      try {
        const body = await readBody(req);
        const result = await handleKol(body);
        json(res, 200, result);
      } catch (err: any) {
        console.error("[API /kol]", err?.message || err);
        json(res, 500, { error: err?.message || "Internal error" });
      }
      return;
    }

    json(res, 404, { error: "Not found" });
  });

  server.listen(API_PORT, () => {
    console.log(`🌐 API server listening on port ${API_PORT}`);
  });

  return server;
}
