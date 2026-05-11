import { Context } from "grammy";
import { getEvmTopHolders } from "../services/moralis";
import { getTokenBuyersFromLogs } from "../services/ankr";
import { getTokenInfo, detectEvmChain } from "../services/dexscreener";
import { filterEoaTraders } from "../services/evm_filters";
import { shortenEvmAddress, escHtml } from "../utils/evm";
import { splitMessage } from "../utils/format";
import {
  analyzeTokenForWallets,
  getWalletFunding,
  getNativeBalance,
  TokenBuyStats,
  WalletFunding,
} from "../services/wallet_analysis";

const NATIVE_SYMBOL: Record<string, string> = {
  eth: "ETH", bsc: "BNB", base: "ETH", arbitrum: "ETH",
};

function fmtNum(n: number): string {
  if (!isFinite(n) || n === 0) return "0";
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.001) return n.toFixed(4);
  return n.toExponential(2);
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(2)}`;
}

function statusEmoji(s: TokenBuyStats["status"]): string {
  switch (s) {
    case "holding":    return "💎";
    case "partial":    return "🔸";
    case "sold_all":   return "❌";
    case "never_bought": return "·";
  }
}

function fundingTag(f: WalletFunding): string {
  if (f.source === "UNKNOWN") return "<i>anónima</i>";
  const label = f.label || f.source;
  return `<b>${escHtml(label)}</b>`;
}

const CHAIN_EXPLORERS: Record<string, string> = {
  eth: "https://etherscan.io/address/",
  bsc: "https://bscscan.com/address/",
  base: "https://basescan.org/address/",
  arbitrum: "https://arbiscan.io/address/",
};

// Parse "desde:YYYY-MM-DD" or "desde:marzo" / "desde:march" from args
function parseFromDate(args: string[]): { mints: string[]; fromDate?: Date } {
  const MONTH_MAP: Record<string, number> = {
    enero: 0, january: 0, jan: 0,
    febrero: 1, february: 1, feb: 1,
    marzo: 2, march: 2, mar: 2,
    abril: 3, april: 3, apr: 3,
    mayo: 4, may: 4,
    junio: 5, june: 5, jun: 5,
    julio: 6, july: 6, jul: 6,
    agosto: 7, august: 7, aug: 7,
    septiembre: 8, september: 8, sep: 8,
    octubre: 9, october: 9, oct: 9,
    noviembre: 10, november: 10, nov: 10,
    diciembre: 11, december: 11, dec: 11,
  };

  let fromDate: Date | undefined;
  const mints: string[] = [];

  for (const arg of args) {
    const lower = arg.toLowerCase();
    if (lower.startsWith("desde:") || lower.startsWith("from:")) {
      const val = lower.split(":")[1];
      // YYYY-MM-DD
      if (/^\d{4}-\d{2}-\d{2}$/.test(val)) {
        fromDate = new Date(val + "T00:00:00Z");
      } else if (MONTH_MAP[val] !== undefined) {
        // "marzo" → first day of that month in current year
        const now = new Date();
        fromDate = new Date(Date.UTC(now.getFullYear(), MONTH_MAP[val], 1));
      }
    } else {
      mints.push(arg);
    }
  }

  return { mints, fromDate };
}

export async function handleEvmKol(ctx: Context, rawArgs: string[]): Promise<void> {
  const { mints, fromDate: userFromDate } = parseFromDate(rawArgs);
  const statusMsg = await ctx.reply(`🔍 Detecting chain and fetching buyers for ${mints.length} tokens...`);

  try {
    const chain = await detectEvmChain(mints[0]);
    const explorer = CHAIN_EXPLORERS[chain] || "https://etherscan.io/address/";

    // Fetch token info first to know token age
    const tokenInfos = await Promise.all(mints.map((m) => getTokenInfo(m).catch(() => null)));

    // Auto-decide range based on the OLDEST token in the set (so we cover all):
    //   - If user passed `desde:` explicitly, respect it.
    //   - Else if oldest token <60d old → fetch full history (no fromDate, large cap).
    //   - Else → fetch last 90 days.
    const DAY_MS = 86_400_000;
    const now = Date.now();
    const oldestCreated = tokenInfos
      .map((t) => t?.pairCreatedAt || 0)
      .filter((ts) => ts > 0)
      .reduce((min, ts) => (ts < min ? ts : min), Infinity);
    const ageDays = oldestCreated === Infinity ? 0 : (now - oldestCreated) / DAY_MS;

    let fromDate: Date | undefined;
    let rangeLabel: string;
    let autoNote = "";

    if (userFromDate) {
      fromDate = userFromDate;
      rangeLabel = `desde ${fromDate.toISOString().slice(0, 10)}`;
    } else if (ageDays > 0 && ageDays <= 60) {
      fromDate = undefined;
      rangeLabel = `histórico completo (~${ageDays.toFixed(0)}d)`;
    } else {
      fromDate = new Date(now - 90 * DAY_MS);
      const oldestDate = new Date(oldestCreated).toISOString().slice(0, 10);
      rangeLabel = "últimos 90 días";
      autoNote = `\n<i>⚠️ Token más antiguo: ${oldestDate} (${ageDays.toFixed(0)}d). Para ver todo el histórico usa <code>desde:YYYY-MM-DD</code>.</i>`;
    }

    await ctx.api.editMessageText(
      ctx.chat!.id, statusMsg.message_id,
      `🔍 Fetching on ${chain.toUpperCase()}: top 500 holders + transfers ${rangeLabel} per token...`,
      { parse_mode: "HTML" }
    );

    // Fetch buyers + current holders SECUENCIAL por token (evita 429/500 de Moralis con bursts)
    const buyerSets: Set<string>[] = [];
    const holderSets: any[][] = [];
    for (const m of mints) {
      const [bs, hs] = await Promise.all([
        getTokenBuyersFromLogs(m, chain, fromDate).catch((e: any) => {
          console.log(`[/kol] buyers ${m.slice(0, 10)} ERR:`, e?.message || e);
          return new Set<string>();
        }),
        getEvmTopHolders(m, chain, 100).catch((e) => {
          console.log(`[/kol] holders ${m.slice(0, 10)} ERR:`, e?.message || e);
          return [];
        }),
      ]);
      buyerSets.push(bs);
      holderSets.push(hs);
    }
    console.log(`[/kol] raw: buyers=${buyerSets.map(s=>s.size).join(",")} holders=${holderSets.map(h=>h.length).join(",")}`);

    const symbols = mints.map((_, i) => tokenInfos[i]?.symbol || `Token${i + 1}`);

    // Build holder maps for % and USD display
    const holderMaps = holderSets.map((holders) => {
      const m = new Map<string, { pct: number; usd: number }>();
      for (const h of holders) {
        if (!h.ownerAddress) continue;
        m.set(h.ownerAddress.toLowerCase(), {
          pct: h.percentageRelativeToTotalSupply || 0,
          usd: h.usdValue || 0,
        });
      }
      return m;
    });

    // Merge buyers + holders into one set per token
    const combinedSets = mints.map((_, i) => {
      const combined = new Set(buyerSets[i]);
      for (const h of holderSets[i]) {
        if (h.ownerAddress) combined.add(h.ownerAddress.toLowerCase());
      }
      return combined;
    });

    // Intersection across all tokens
    const [first, ...rest] = combinedSets;
    const intersection = new Set<string>(
      [...first].filter((addr) => rest.every((s) => s.has(addr)))
    );
    console.log(`[/kol] chain=${chain} sizes=${combinedSets.map(s=>s.size).join(",")} intersection=${intersection.size}`);

    // Filter out routers / aggregators / contracts — keep only EOA traders
    await ctx.api.editMessageText(
      ctx.chat!.id, statusMsg.message_id,
      `🔍 Filtering routers and contracts (${intersection.size} candidates)...`
    );
    const { kept, filtered } = await filterEoaTraders(Array.from(intersection), chain);
    const eoaSet = new Set(kept);
    console.log(`[/kol] after filter: kept=${kept.length} filtered=${filtered}`);

    if (eoaSet.size === 0) {
      await ctx.api.editMessageText(
        ctx.chat!.id, statusMsg.message_id,
        `🎯 <b>KOL Finder — ${symbols.map(escHtml).join(" + ")}</b>\n\nNo wallets found that bought all ${mints.length} tokens.\n\n<i>Searched last ~500 transfers per token on ${chain.toUpperCase()}.</i>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // ─── Deep analysis: per-token buy stats via Ankr logs + funding + balance ──
    await ctx.api.editMessageText(
      ctx.chat!.id, statusMsg.message_id,
      `🔬 Analizando ${eoaSet.size} wallets vs ${mints.length} tokens (logs Ankr + balances + funding)...`,
      { parse_mode: "HTML" }
    );

    const walletList = Array.from(eoaSet);
    // 1) Por token: 1 sola call de logs + cómputo por wallet (enfoque B)
    const tokenAnalyses = await Promise.all(
      mints.map((m) =>
        analyzeTokenForWallets(m, chain, walletList).catch((e) => {
          console.log(`[/kol] analyze ${m.slice(0, 10)} ERR:`, e?.message || e);
          return null;
        })
      )
    );
    // 2) Por wallet: balance native + funding (paralelo en lotes para no abusar)
    const balances = await Promise.all(walletList.map((w) => getNativeBalance(w, chain).catch(() => 0)));
    const fundings = await Promise.all(
      walletList.map((w) =>
        getWalletFunding(w, chain).catch(() => ({ source: "UNKNOWN" as const, label: null, funderAddress: null }))
      )
    );

    interface DeepEntry {
      address: string;
      nativeBalance: number;
      funding: WalletFunding;
      perToken: Array<{
        symbol: string;
        stats: TokenBuyStats | null;
        holderPct: number;    // % supply ahora mismo (de Moralis holderMaps si está en top 500)
        holderUsd: number;
      }>;
    }

    const results: DeepEntry[] = walletList.map((addr, idx) => {
      const perToken = mints.map((_, i) => {
        const ta = tokenAnalyses[i];
        const stats = ta ? ta.perWallet.get(addr) || null : null;
        const h = holderMaps[i].get(addr);
        return {
          symbol: symbols[i],
          stats,
          holderPct: h?.pct || 0,
          holderUsd: h?.usd || 0,
        };
      });
      return {
        address: addr,
        nativeBalance: balances[idx],
        funding: fundings[idx],
        perToken,
      };
    });

    // Sort: prioriza wallets que aún holdean en >= 1 token, luego por pct de supply comprado
    results.sort((a, b) => {
      const aHolds = a.perToken.filter((p) => p.stats && p.stats.status === "holding").length;
      const bHolds = b.perToken.filter((p) => p.stats && p.stats.status === "holding").length;
      if (aHolds !== bHolds) return bHolds - aHolds;
      const aPct = a.perToken.reduce((s, p) => s + (p.stats?.pctSupplyBought || 0), 0);
      const bPct = b.perToken.reduce((s, p) => s + (p.stats?.pctSupplyBought || 0), 0);
      return bPct - aPct;
    });

    const nativeSym = NATIVE_SYMBOL[chain] || "ETH";
    const lines: string[] = [];
    lines.push(`🎯 <b>KOL Finder — ${symbols.map(escHtml).join(" + ")} [${chain.toUpperCase()}]</b>`);
    lines.push(`Found: <b>${results.length}</b> EOA wallets (filtered ${filtered} routers/contracts)`);
    lines.push(`<i>Rango: ${rangeLabel}</i>${autoNote}\n`);

    const showMax = Math.min(results.length, 50);
    for (let i = 0; i < showMax; i++) {
      const w = results[i];
      const short = shortenEvmAddress(w.address, 4);
      lines.push(`<b>${i + 1}.</b> <a href="${explorer}${w.address}">${escHtml(short)}</a> · 💰 ${fmtNum(w.nativeBalance)} ${nativeSym} · 🔗 ${fundingTag(w.funding)}`);
      lines.push(`<code>${escHtml(w.address)}</code>`);

      for (let j = 0; j < w.perToken.length; j++) {
        const p = w.perToken[j];
        const branch = j === w.perToken.length - 1 ? "└" : "├";
        const s = p.stats;
        if (!s || s.status === "never_bought") {
          lines.push(`  ${branch} ${escHtml(p.symbol)}: <i>no compras detectadas</i>`);
          continue;
        }
        const emoji = statusEmoji(s.status);
        const mc = s.marketCapAtEntry > 0 ? `MC@entry: ${fmtNum(s.marketCapAtEntry)} ${nativeSym}` : "MC@entry: n/d";
        const supplyPct = s.pctSupplyBought > 0 ? `${s.pctSupplyBought.toFixed(3)}%` : "<0.001%";
        lines.push(`  ${branch} ${emoji} <b>${escHtml(p.symbol)}</b>`);
        lines.push(`     ├ Compró: <b>${fmtNum(s.totalBought)}</b> tokens (${supplyPct} supply)`);
        lines.push(`     ├ Gastado aprox: <b>${fmtNum(s.nativeSpent)} ${nativeSym}</b> · ${mc}`);
        const ahora = p.holderPct > 0
          ? `${p.holderPct.toFixed(3)}% · ${fmtUsd(p.holderUsd)}`
          : `${fmtNum(s.currentBalance)} tokens`;
        const estado = s.status === "holding" ? "holdea todo" :
                       s.status === "partial" ? `vendió parte (queda ${fmtNum(s.currentBalance)})` :
                       "vendió todo";
        lines.push(`     └ Ahora: ${ahora} · <i>${estado}</i>`);
      }
      lines.push("");
    }

    if (results.length > showMax) {
      lines.push(`<i>... and ${results.length - showMax} more wallets</i>`);
    }

    const parts = splitMessage(lines.join("\n"), 3800);
    await ctx.api.editMessageText(
      ctx.chat!.id, statusMsg.message_id, parts[0],
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
    );
    for (let i = 1; i < parts.length; i++) {
      await ctx.reply(parts[i], { parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    }
  } catch (err) {
    console.error("EVM KOL error:", err);
    await ctx.api.editMessageText(
      ctx.chat!.id, statusMsg.message_id,
      "❌ Error fetching data. Please try again."
    );
  }
}
