import { Context } from "grammy";
import { getTokenInfo } from "../services/dexscreener";
import { isValidSolanaAddress } from "../utils/solana";
import { escMd, formatUsd, splitMessage } from "../utils/format";

function formatDate(timestampMs: number): string {
  if (!timestampMs) return "Unknown";
  return new Date(timestampMs).toUTCString().replace(",", "\\,");
}

export async function handleDex(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const args = text.split(/\s+/).slice(1);

  if (args.length === 0) {
    await ctx.reply(
      "Usage: /dex <contract>\n\nFetch token info from DEXScreener."
    );
    return;
  }

  const mint = args[0];
  if (!isValidSolanaAddress(mint)) {
    await ctx.reply("❌ Invalid Solana address.");
    return;
  }

  const statusMsg = await ctx.reply("📊 Fetching DEXScreener data...");

  try {
    const info = await getTokenInfo(mint);

    if (!info) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        "❌ Token not found on DEXScreener."
      );
      return;
    }

    const priceStr = info.priceUsd < 0.000001
      ? info.priceUsd.toExponential(4)
      : info.priceUsd.toFixed(6);

    let body = `*📊 DEXScreener Info*\n\n`;
    body += `*${escMd(info.name)}* \\(${escMd(info.symbol)}\\)\n`;
    body += `\`${escMd(mint)}\`\n\n`;

    body += `💵 Price: \`$${escMd(priceStr)}\`\n`;
    body += `📈 Market Cap: \`${escMd(formatUsd(info.marketCap))}\`\n`;
    body += `📊 24h Volume: \`${escMd(formatUsd(info.volume24h))}\`\n`;
    body += `💧 Liquidity: \`${escMd(formatUsd(info.liquidity))}\`\n`;
    body += `🏦 DEX: \`${escMd(info.dexId)}\`\n`;
    body += `🔗 Pair: \`${escMd(info.pairAddress)}\`\n`;

    if (info.pairCreatedAt) {
      body += `📅 Created: \`${escMd(formatDate(info.pairCreatedAt))}\`\n`;
    }

    const links: string[] = [];
    if (info.website) {
      links.push(`[Website](${escMd(info.website)})`);
    }
    if (info.twitter) {
      links.push(`[Twitter](${escMd(info.twitter)})`);
    }
    links.push(`[DexScreener](https://dexscreener\\.com/solana/${escMd(mint)})`);

    body += `\n🔗 ${links.join(" \\| ")}`;

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
    console.error("Dex command error:", err);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      "❌ Error fetching DEXScreener data. Please try again later."
    );
  }
}
