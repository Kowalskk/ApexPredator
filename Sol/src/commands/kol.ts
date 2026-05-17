import { Context } from "grammy";
import { findCommonHolders } from "../services/helius";
import { getTokenInfo } from "../services/dexscreener";
import { classifyWallet } from "../services/labels";
import { isValidSolanaAddress, shortenAddress } from "../utils/solana";
import { isValidEvmAddress } from "../utils/evm";
import { handleEvmKol } from "./evm_kol";
import { escMd, splitMessage } from "../utils/format";
import { config } from "../config";

function fmtAmount(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function fmtPct(pct: number): string {
  if (pct < 0.001) return "<0.001%";
  if (pct < 0.01) return `${pct.toFixed(3)}%`;
  return `${pct.toFixed(2)}%`;
}

export async function handleKol(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  // Support both space and newline as separator
  const args = text.trim().split(/[\s\n]+/).slice(1).filter(Boolean);

  const mintArgs = args.filter((a) => !a.toLowerCase().startsWith("desde:") && !a.toLowerCase().startsWith("from:"));
  if (mintArgs.length === 0 || mintArgs.length > config.maxContracts) {
    await ctx.reply(
      `📖 *Overlap Wallets*\n\n` +
      `Usage: /kol \\<ca1\\> \\<ca2\\> \\[ca3\\] \\[ca4\\] \\[desde:YYYY\\-MM\\-DD\\]\n\n` +
      `Finds wallets that hold ALL given tokens\\.\n` +
      `EVM: mezcla ETH \\+ BSC libremente\\. Agrega \`desde:marzo\` para cubrir un período\\.\n\n` +
      `Max ${config.maxContracts} contracts\\.`,
      { parse_mode: "MarkdownV2" }
    );
    return;
  }

  // Route to EVM handler if all CA args are 0x...
  if (mintArgs.every((a) => isValidEvmAddress(a))) {
    return handleEvmKol(ctx, args);
  }

  const invalid = mintArgs.filter((a) => !isValidSolanaAddress(a));
  if (invalid.length > 0) {
    await ctx.reply(`❌ Invalid address: ${invalid[0].slice(0, 12)}...`);
    return;
  }

  const statusMsg = await ctx.reply(
    `🔍 Searching across ${args.length} token${args.length > 1 ? "s" : ""}\\.\\.\\. filtering bots`,
    { parse_mode: "MarkdownV2" }
  );

  try {
    // Fetch token symbols + KOL results in parallel
    const [tokenInfos, result] = await Promise.all([
      Promise.all(args.map((mint) => getTokenInfo(mint).catch(() => null))),
      findCommonHolders(args, 5000, args.length === 1 ? 0 : 0.001),
    ]);

    const symbols = args.map((_, i) => tokenInfos[i]?.symbol || `Token${i + 1}`);

    if (result.wallets.length === 0) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        `🎯 *Overlap Wallets*\n\nNo wallets found holding all ${args.length} tokens\\.\n\n_${escMd(String(result.filteredCount))} dust\\/bot wallets were filtered\\._`,
        { parse_mode: "MarkdownV2" }
      );
      return;
    }

    // Sort by highest average supply % across all tokens
    const sorted = [...result.wallets].sort((a, b) => {
      const avgA = a.holdings.reduce((s, h) => s + h.supplyPct, 0) / a.holdings.length;
      const avgB = b.holdings.reduce((s, h) => s + h.supplyPct, 0) / b.holdings.length;
      return avgB - avgA;
    });

    const lines: string[] = [];

    // Header
    lines.push(`🎯 *Overlap Wallets — ${symbols.map(escMd).join(" \\+ ")}*\n`);
    lines.push(
      `Found: *${escMd(String(sorted.length))}* wallets  ` +
      `\\(_${escMd(String(result.filteredCount))} dust filtered_\\)\n` +
      `Min holding: ${args.length === 1 ? "none" : "0\\.001%"} per token\n`
    );

    // Wallet entries (cap at 50 to keep message manageable)
    const showMax = Math.min(sorted.length, 50);
    for (let i = 0; i < showMax; i++) {
      const w = sorted[i];

      // Quick classification (no API call — just labels lookup)
      const { exchangeName, emojis } = classifyWallet({
        address: w.address,
        holdingPct: w.holdings[0]?.supplyPct || 0,
        totalPortfolioUsd: 0,
        holdings: [],
        isFresh: false,
      });

      const displayName = exchangeName
        ? `*${escMd(exchangeName)}*`
        : `[${escMd(shortenAddress(w.address, 4))}](https://solscan\\.io/account/${escMd(w.address)})`;

      const solscanLink = `[↗](https://solscan\\.io/account/${escMd(w.address)})`;

      lines.push(`*${i + 1}\\.* ${displayName} ${solscanLink} ${emojis}`);
      // Full address on its own line for easy copy
      lines.push(`\`${escMd(w.address)}\``);

      // Show holdings for each token
      for (let j = 0; j < w.holdings.length; j++) {
        const h = w.holdings[j];
        const sym = escMd(symbols[j]);
        const amt = escMd(fmtAmount(h.amount));
        const pct = escMd(fmtPct(h.supplyPct));
        const isLast = j === w.holdings.length - 1;
        const branch = isLast ? "└" : "├";
        lines.push(`  ${branch} ${sym}: ${amt} \\(${pct}\\)`);
      }
    }

    if (sorted.length > showMax) {
      lines.push(`\n_\\.\\.\\. and ${escMd(String(sorted.length - showMax))} more wallets_`);
    }

    const fullText = lines.join("\n");
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
    console.error("KOL command error:", err);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      "❌ Error fetching data. Please try again later."
    );
  }
}
