import { Context } from "grammy";
import { getTopHolders, getWalletAssets, getTokenSupply, checkIsLpWallet } from "../services/helius";
import { getTokenInfo } from "../services/dexscreener";
import { checkWalletAge } from "../services/helius_extended";
import { classifyWallet } from "../services/labels";
import { isValidSolanaAddress, shortenAddress } from "../utils/solana";
import { escMd, splitMessage } from "../utils/format";
import { config } from "../config";
import { TokenHolding } from "../types";

// ─── Formatting helpers ──────────────────────────────────────────────────────

function fmtUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

function fmtPct(pct: number): string {
  if (pct < 0.01) return "<0.01%";
  if (pct < 1) return `${pct.toFixed(2)}%`;
  return `${pct.toFixed(2)}%`;
}

/**
 * Calculate % of a token's supply from a holding.
 * Returns null if supply data is not available.
 */
function supplyPct(holding: TokenHolding): string | null {
  if (!holding.totalSupply || holding.totalSupply === 0) return null;
  const pct = (holding.rawBalance / holding.totalSupply) * 100;
  if (pct < 0.0001) return null;
  return fmtPct(pct);
}

// ─── Main handler ────────────────────────────────────────────────────────────

export async function handleTopHolders(ctx: Context, topN: number): Promise<void> {
  const text = ctx.message?.text || "";
  const args = text.split(/\s+/).slice(1);

  if (args.length === 0) {
    await ctx.reply(`Usage: /top${topN} <contract_address>`);
    return;
  }

  const mint = args[0];
  if (!isValidSolanaAddress(mint)) {
    await ctx.reply("❌ Invalid Solana address.");
    return;
  }

  const statusMsg = await ctx.reply(`🔍 Fetching top ${topN} holders\\.\\.\\.`, {
    parse_mode: "MarkdownV2",
  });

  try {
    // Fetch token info, holders, and real total supply in parallel
    const [tokenInfo, holders, supplyData] = await Promise.all([
      getTokenInfo(mint).catch(() => null),
      getTopHolders(mint, topN),
      getTokenSupply(mint).catch(() => ({ uiAmount: 0, rawAmount: 0, decimals: 0 })),
    ]);

    if (holders.length === 0) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        "No holders found for this token."
      );
      return;
    }

    const tokenSymbol = tokenInfo?.symbol || "TOKEN";
    // Use real on-chain supply — fall back to sum of fetched holders only if supply query failed
    const realTotalSupply = supplyData.rawAmount > 0
      ? supplyData.rawAmount
      : holders.reduce((sum, h) => sum + h.amount, 0);

    const blocks: string[] = [];
    blocks.push(`🐺 *Top ${topN} Wallets — ${escMd(tokenSymbol)}*\n`);

    for (let i = 0; i < holders.length; i++) {
      const holder = holders[i];

      // Progress update every 5 holders
      if (i > 0 && i % 5 === 0) {
        try {
          await ctx.api.editMessageText(
            ctx.chat!.id,
            statusMsg.message_id,
            `🔍 Loading portfolios\\.\\.\\. ${i}/${holders.length}`,
            { parse_mode: "MarkdownV2" }
          );
        } catch {}
      }

      // % of real total supply (accurate)
      const holdingPct = realTotalSupply > 0
        ? (holder.amount / realTotalSupply) * 100
        : 0;

      // For large holders (>3% supply), check if it's an LP vault
      let isLp = false;
      if (holdingPct >= 3) {
        isLp = await checkIsLpWallet(holder.owner).catch(() => false);
      }

      // Fetch portfolio + wallet age in parallel
      let holdings: TokenHolding[] = [];
      let isFresh = false;

      try {
        const [rawHoldings, ageInfo] = await Promise.all([
          getWalletAssets(holder.owner),
          checkWalletAge(holder.owner),
        ]);
        holdings = rawHoldings;
        isFresh = ageInfo.isFresh;
      } catch {}

      const totalPortfolioUsd = holdings.reduce((s, h) => s + h.usdValue, 0);

      // Build display: LP overrides normal classification
      let displayName: string;
      let emojis: string;

      if (isLp) {
        displayName = `[\`${escMd(shortenAddress(holder.owner, 6))}\`](https://solscan\\.io/account/${escMd(holder.owner)})`;
        emojis = "💧 *LP*";
      } else {
        const { exchangeName, emojis: classEmojis } = classifyWallet({
          address: holder.owner,
          holdingPct,
          totalPortfolioUsd,
          holdings,
          isFresh,
        });

        if (exchangeName) {
          displayName = `[*${escMd(exchangeName)}*](https://solscan\\.io/account/${escMd(holder.owner)})`;
          emojis = "🏦";
        } else {
          displayName = `[\`${escMd(shortenAddress(holder.owner, 6))}\`](https://solscan\\.io/account/${escMd(holder.owner)})`;
          emojis = classEmojis;
        }
      }

      // Header: #N  Address [X.XX%] SYMBOL  🐋 🌱
      const pctStr = escMd(fmtPct(holdingPct));
      const symStr = escMd(tokenSymbol);
      blocks.push(`*\\#${i + 1}* ${displayName} \\[${pctStr}\\] ${escMd(tokenSymbol)} ${emojis}`);

      // Top 5 portfolio holdings (exclude the analyzed token itself)
      const topHoldings = holdings
        .filter((h) => h.mint !== mint && h.usdValue >= config.minHoldingValueUsd)
        .sort((a, b) => b.usdValue - a.usdValue)
        .slice(0, 5);

      for (let j = 0; j < topHoldings.length; j++) {
        const h = topHoldings[j];
        const isLast = j === topHoldings.length - 1;
        const branch = isLast ? "└" : "├";
        const sym = escMd(h.symbol || "???");
        const usd = escMd(fmtUsd(h.usdValue));
        const pct = supplyPct(h);
        const pctPart = pct ? ` \\(${escMd(pct)}\\)` : "";
        blocks.push(`${branch} ${sym}: ${usd}${pctPart}`);
      }

      blocks.push(""); // blank line separator
    }

    // Bottom links
    const mintEsc = escMd(mint);
    blocks.push(
      `[DEF](https://www\\.defined\\.fi/sol/${mintEsc}) \\• ` +
      `[DS](https://dexscreener\\.com/solana/${mintEsc}) \\• ` +
      `[GT](https://www\\.geckoterminal\\.com/solana/tokens/${mintEsc})`
    );

    const fullText = blocks.join("\n");
    const parts = splitMessage(fullText, 3800);

    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      parts[0],
      { parse_mode: "MarkdownV2", link_preview_options: { is_disabled: true } }
    );

    for (let i = 1; i < parts.length; i++) {
      await ctx.reply(parts[i], {
        parse_mode: "MarkdownV2",
        link_preview_options: { is_disabled: true },
      });
    }
  } catch (err) {
    console.error(`Top${topN} error:`, err);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      "❌ Error fetching holder data. Please try again later."
    );
  }
}
