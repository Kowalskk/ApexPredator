import { Context } from "grammy";
import { analyzeSniperCabal } from "../services/cabal";
import { isValidSolanaAddress, shortenAddress } from "../utils/solana";
import { escMd, splitMessage } from "../utils/format";
import { SniperWallet } from "../types";

const MAX_TOKENS = 5;

function fmtSol(n: number): string {
  if (n >= 100) return `${n.toFixed(0)} SOL`;
  if (n >= 1) return `${n.toFixed(2)} SOL`;
  return `${n.toFixed(3)} SOL`;
}

function fmtGap(seconds: number): string {
  if (seconds < 0) return "?";
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
}

function walletLine(s: SniperWallet): string[] {
  const lines: string[] = [];
  const short = escMd(shortenAddress(s.address, 4));
  const link = `[${short}](https://solscan\\.io/account/${escMd(s.address)})`;
  const tokensStr = s.tokensSniped
    .map((t) => `${escMd(t.symbol)}\\(${escMd(fmtSol(t.solBought))}\\)`)
    .join(", ");
  lines.push(`  • ${link} → ${tokensStr}`);

  if (s.funder) {
    const funderShort = escMd(shortenAddress(s.funder, 4));
    const funderLink = `[${funderShort}](https://solscan\\.io/account/${escMd(s.funder)})`;
    const label = s.funderLabel ? ` \\[${escMd(s.funderLabel)}\\]` : "";
    const amt = escMd(fmtSol(s.fundingAmount));
    const gap = escMd(fmtGap(s.gapSecondsBeforeFirstBuy));
    lines.push(`    funded ${amt} by ${funderLink}${label}, gap ${gap}`);
  }
  lines.push(`    \`${escMd(s.address)}\``);
  return lines;
}

export async function handleSnipers(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const args = text.trim().split(/[\s\n]+/).slice(1).filter(Boolean);

  if (args.length === 0 || args.length > MAX_TOKENS) {
    await ctx.reply(
      "<b>🎯 Sniper Cabal Analysis</b>\n\n" +
        `Usage: /snipers &lt;ca1&gt; &lt;ca2&gt; ... (max ${MAX_TOKENS})\n\n` +
        "Finds wallets that snipe multiple tokens from the same operator.\n" +
        "Clusters them by shared funder, funding amount and timing pattern.\n\n" +
        "Works best with pump.fun tokens.",
      { parse_mode: "HTML" }
    );
    return;
  }

  const invalid = args.filter((a) => !isValidSolanaAddress(a));
  if (invalid.length > 0) {
    await ctx.reply(`❌ Invalid address: ${invalid[0].slice(0, 12)}...`);
    return;
  }

  const statusMsg = await ctx.reply(
    `🎯 Analyzing snipers across ${args.length} token${args.length > 1 ? "s" : ""}\\.\\.\\.\n_Fetching early buyers and tracing funders_`,
    { parse_mode: "MarkdownV2" }
  );

  try {
    const result = await analyzeSniperCabal(args);

    if (result.totalSnipers === 0) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        "🎯 *Sniper Cabal Analysis*\n\nNo early buyers found\\. Make sure these are pump\\.fun tokens\\.",
        { parse_mode: "MarkdownV2" }
      );
      return;
    }

    const lines: string[] = [];
    const tokenList = result.tokens.map((t) => escMd(t.symbol)).join(", ");
    lines.push(`🎯 *Sniper Cabal Analysis*`);
    lines.push(`Tokens: *${tokenList}*`);
    lines.push(`Snipers analyzed: *${result.totalSnipers}*`);
    lines.push(`Clusters found: *${result.clusters.length}*`);
    lines.push("");

    if (result.clusters.length === 0) {
      lines.push(`_No sniper clusters detected\\. All early buyers look independent\\._`);
    }

    for (const cluster of result.clusters) {
      lines.push(`━━━ *CLUSTER ${cluster.id}* ━━━`);
      lines.push(`_${escMd(cluster.reason)}_`);
      if (cluster.sharedFunder) {
        const label = cluster.wallets[0].funderLabel;
        const labelStr = label ? ` \\[${escMd(label)}\\]` : "";
        const fShort = escMd(shortenAddress(cluster.sharedFunder, 4));
        lines.push(
          `Funder: [${fShort}](https://solscan\\.io/account/${escMd(cluster.sharedFunder)})${labelStr}`
        );
        lines.push(`\`${escMd(cluster.sharedFunder)}\``);
      }
      lines.push("");
      for (const wallet of cluster.wallets) {
        lines.push(...walletLine(wallet));
      }
      lines.push("");
    }

    if (result.orphans.length > 0) {
      lines.push(`━━━ *ORPHANS \\(${result.orphans.length}\\)* ━━━`);
      lines.push(`_Random early buyers, no pattern detected_`);
      lines.push("");
      // Show max 5 orphans to keep message size manageable
      for (const wallet of result.orphans.slice(0, 5)) {
        lines.push(...walletLine(wallet));
      }
      if (result.orphans.length > 5) {
        lines.push(`_\\.\\.\\. and ${result.orphans.length - 5} more orphans_`);
      }
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
    console.error("Snipers command error:", err);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      "❌ Error analyzing snipers. Please try again later."
    );
  }
}
