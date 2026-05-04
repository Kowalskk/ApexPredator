import { Context } from "grammy";
import { getEvmTopHolders } from "../services/moralis";
import { getTokenInfo, detectEvmChain } from "../services/dexscreener";
import { shortenEvmAddress, escHtml } from "../utils/evm";
import { splitMessage } from "../utils/format";

const CHAIN_EXPLORERS: Record<string, string> = {
  eth: "https://etherscan.io/address/",
  bsc: "https://bscscan.com/address/",
  base: "https://basescan.org/address/",
  arbitrum: "https://arbiscan.io/address/",
};

export async function handleEvmKol(ctx: Context, mints: string[]): Promise<void> {
  const statusMsg = await ctx.reply(`🔍 Detecting chain and fetching holders for ${mints.length} tokens...`);

  try {
    // Auto-detect chain from first token
    const chain = await detectEvmChain(mints[0]);
    const explorer = CHAIN_EXPLORERS[chain] || "https://etherscan.io/address/";

    await ctx.api.editMessageText(
      ctx.chat!.id, statusMsg.message_id,
      `🔍 Fetching top holders on ${chain.toUpperCase()} for ${mints.length} tokens...`
    );

    // Fetch top 500 holders + token info for each token in parallel
    const [holderSets, tokenInfos] = await Promise.all([
      Promise.all(mints.map((m) => getEvmTopHolders(m, chain, 500).catch(() => []))),
      Promise.all(mints.map((m) => getTokenInfo(m).catch(() => null))),
    ]);

    const symbols = mints.map((_, i) => tokenInfos[i]?.symbol || `Token${i + 1}`);

    // Build map: address → { pct per token }
    interface HolderEntry {
      address: string;
      holdings: { symbol: string; pct: number; usd: number }[];
    }

    // For each token, build a map address → {pct, usd}
    const tokenMaps = holderSets.map((holders, ti) => {
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

    // Intersection: wallets that appear in ALL token maps
    const baseMap = tokenMaps[0];
    const results: HolderEntry[] = [];

    for (const [addr, first] of baseMap.entries()) {
      let inAll = true;
      const holdings: { symbol: string; pct: number; usd: number }[] = [
        { symbol: symbols[0], pct: first.pct, usd: first.usd },
      ];

      for (let i = 1; i < tokenMaps.length; i++) {
        const entry = tokenMaps[i].get(addr);
        if (!entry) { inAll = false; break; }
        holdings.push({ symbol: symbols[i], pct: entry.pct, usd: entry.usd });
      }

      if (inAll) results.push({ address: addr, holdings });
    }

    // Sort by average % across tokens
    results.sort((a, b) => {
      const avgA = a.holdings.reduce((s, h) => s + h.pct, 0) / a.holdings.length;
      const avgB = b.holdings.reduce((s, h) => s + h.pct, 0) / b.holdings.length;
      return avgB - avgA;
    });

    if (results.length === 0) {
      await ctx.api.editMessageText(
        ctx.chat!.id, statusMsg.message_id,
        `🎯 <b>KOL Finder</b>\n\nNo wallets found holding all ${mints.length} tokens in top 500 holders each.`,
        { parse_mode: "HTML" }
      );
      return;
    }

    const lines: string[] = [];
    lines.push(`🎯 <b>KOL Finder — ${symbols.map(escHtml).join(" + ")} [${chain.toUpperCase()}]</b>`);
    lines.push(`Found: <b>${results.length}</b> wallets (from top 500 holders each)\n`);

    const showMax = Math.min(results.length, 50);
    for (let i = 0; i < showMax; i++) {
      const w = results[i];
      const short = shortenEvmAddress(w.address, 4);
      lines.push(`${i + 1}. <a href="${explorer}${w.address}">${escHtml(short)}</a>`);
      lines.push(`<code>${escHtml(w.address)}</code>`);

      for (let j = 0; j < w.holdings.length; j++) {
        const h = w.holdings[j];
        const branch = j === w.holdings.length - 1 ? "└" : "├";
        const usd = h.usd >= 1000 ? `$${(h.usd / 1000).toFixed(1)}K` : `$${h.usd.toFixed(0)}`;
        lines.push(`  ${branch} ${escHtml(h.symbol)}: <b>${h.pct.toFixed(3)}%</b> · <code>${escHtml(usd)}</code>`);
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
      "❌ Error fetching holders. Please try again."
    );
  }
}
