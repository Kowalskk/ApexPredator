import { Context } from "grammy";
import { getEvmTokenBuyers, getEvmTopHolders } from "../services/moralis";
import { getTokenInfo, detectEvmChain } from "../services/dexscreener";
import { filterEoaTraders } from "../services/evm_filters";
import { shortenEvmAddress, escHtml } from "../utils/evm";
import { splitMessage } from "../utils/format";

const CHAIN_EXPLORERS: Record<string, string> = {
  eth: "https://etherscan.io/address/",
  bsc: "https://bscscan.com/address/",
  base: "https://basescan.org/address/",
  arbitrum: "https://arbiscan.io/address/",
};

export async function handleEvmKol(ctx: Context, mints: string[]): Promise<void> {
  const statusMsg = await ctx.reply(`🔍 Detecting chain and fetching buyers for ${mints.length} tokens...`);

  try {
    const chain = await detectEvmChain(mints[0]);
    const explorer = CHAIN_EXPLORERS[chain] || "https://etherscan.io/address/";

    await ctx.api.editMessageText(
      ctx.chat!.id, statusMsg.message_id,
      `🔍 Fetching on ${chain.toUpperCase()}: top 500 holders + last 1000 transfers per token...`
    );

    // Fetch buyers (last 1000 transfers) + current holders (top 500) + token info in parallel
    const [buyerSets, holderSets, tokenInfos] = await Promise.all([
      Promise.all(mints.map((m) => getEvmTokenBuyers(m, chain, 10).catch(() => new Set<string>()))),
      Promise.all(mints.map((m) => getEvmTopHolders(m, chain, 500).catch(() => []))),
      Promise.all(mints.map((m) => getTokenInfo(m).catch(() => null))),
    ]);

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

    // Filter out routers / aggregators / contracts — keep only EOA traders
    await ctx.api.editMessageText(
      ctx.chat!.id, statusMsg.message_id,
      `🔍 Filtering routers and contracts (${intersection.size} candidates)...`
    );
    const { kept, filtered } = await filterEoaTraders(Array.from(intersection), chain);
    const eoaSet = new Set(kept);

    if (eoaSet.size === 0) {
      await ctx.api.editMessageText(
        ctx.chat!.id, statusMsg.message_id,
        `🎯 <b>KOL Finder — ${symbols.map(escHtml).join(" + ")}</b>\n\nNo wallets found that bought all ${mints.length} tokens.\n\n<i>Searched last ~500 transfers per token on ${chain.toUpperCase()}.</i>`,
        { parse_mode: "HTML" }
      );
      return;
    }

    // Build result entries sorted by highest current holding % in first token
    interface Entry { address: string; holdings: { symbol: string; pct: number; usd: number; isHolder: boolean }[] }
    const results: Entry[] = [];

    for (const addr of eoaSet) {
      const holdings = mints.map((_, i) => {
        const h = holderMaps[i].get(addr);
        return {
          symbol: symbols[i],
          pct: h?.pct || 0,
          usd: h?.usd || 0,
          isHolder: !!h,
        };
      });
      results.push({ address: addr, holdings });
    }

    results.sort((a, b) => {
      const avgA = a.holdings.reduce((s, h) => s + h.pct, 0) / a.holdings.length;
      const avgB = b.holdings.reduce((s, h) => s + h.pct, 0) / b.holdings.length;
      return avgB - avgA;
    });

    const lines: string[] = [];
    lines.push(`🎯 <b>KOL Finder — ${symbols.map(escHtml).join(" + ")} [${chain.toUpperCase()}]</b>`);
    lines.push(`Found: <b>${results.length}</b> EOA wallets (filtered ${filtered} routers/contracts)\n`);

    const showMax = Math.min(results.length, 50);
    for (let i = 0; i < showMax; i++) {
      const w = results[i];
      const short = shortenEvmAddress(w.address, 4);
      lines.push(`${i + 1}. <a href="${explorer}${w.address}">${escHtml(short)}</a>`);
      lines.push(`<code>${escHtml(w.address)}</code>`);

      for (let j = 0; j < w.holdings.length; j++) {
        const h = w.holdings[j];
        const branch = j === w.holdings.length - 1 ? "└" : "├";
        const status = h.isHolder
          ? `<b>${h.pct.toFixed(3)}%</b> · <code>${h.usd >= 1000 ? `$${(h.usd / 1000).toFixed(1)}K` : `$${h.usd.toFixed(0)}`}</code>`
          : `<i>sold / transferred</i>`;
        lines.push(`  ${branch} ${escHtml(h.symbol)}: ${status}`);
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
