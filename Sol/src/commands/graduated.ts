import { Context } from "grammy";
import { getRecentGraduated } from "../services/pumpfun";
import { escMd, formatUsd, splitMessage } from "../utils/format";

function timeAgo(timestampMs: number): string {
  const seconds = Math.floor(Date.now() / 1000) - Math.floor(timestampMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export async function handleGraduated(ctx: Context): Promise<void> {
  const statusMsg = await ctx.reply("🎓 Fetching recently graduated tokens...");

  try {
    const tokens = await getRecentGraduated(10);

    if (tokens.length === 0) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        "❌ No recently graduated tokens found."
      );
      return;
    }

    let body = `*🎓 Recently Graduated from pump\\.fun*\n\n`;
    body += `_Tokens that completed the bonding curve_\n\n`;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const name = escMd(token.name);
      const symbol = escMd(token.symbol);
      const mcap = escMd(formatUsd(token.usdMarketCap));
      const created = escMd(timeAgo(token.createdTimestamp));
      const dexLink = `[DexScreener](https://dexscreener\\.com/solana/${escMd(token.mint)})`;

      body += `*${i + 1}\\.* *${name}* \\(${symbol}\\)\n`;
      body += `  MCap: \`${mcap}\`  Created: ${created}\n`;
      body += `  ${dexLink}\n\n`;
    }

    const parts = splitMessage(body);

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
    console.error("Graduated command error:", err);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      "❌ Error fetching graduated tokens. Please try again later."
    );
  }
}
