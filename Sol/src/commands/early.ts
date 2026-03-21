import { Context } from "grammy";
import { getTokenEarlyBuyers } from "../services/pumpfun";
import { isValidSolanaAddress, shortenAddress } from "../utils/solana";
import { escMd, formatAmount, splitMessage } from "../utils/format";

function timeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000) - timestamp;
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export async function handleEarly(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const args = text.split(/\s+/).slice(1);

  if (args.length === 0) {
    await ctx.reply(
      "Usage: /early <contract>\n\nGet the first buyers of a pump.fun token."
    );
    return;
  }

  const mint = args[0];
  if (!isValidSolanaAddress(mint)) {
    await ctx.reply("❌ Invalid Solana address.");
    return;
  }

  const statusMsg = await ctx.reply("🚀 Fetching early buyers...");

  try {
    const buyers = await getTokenEarlyBuyers(mint);

    if (buyers.length === 0) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        "❌ Token not found on pump.fun or no buy trades recorded.\n\n_Note: pump.fun tokens only_",
        { parse_mode: "MarkdownV2" }
      );
      return;
    }

    const top20 = buyers.slice(0, 20);

    let body = `*🚀 Early Buyers*\n\n`;
    body += `Token: \`${escMd(mint.slice(0, 8))}\\.\\.\\.\`\n`;
    body += `_pump\\.fun tokens only_\n\n`;

    for (let i = 0; i < top20.length; i++) {
      const buyer = top20[i];
      const shortAddr = escMd(shortenAddress(buyer.wallet, 6));
      const link = `[${shortAddr}](https://solscan\\.io/account/${escMd(buyer.wallet)})`;
      const sol = escMd(buyer.solAmount.toFixed(3));
      const tokens = escMd(formatAmount(buyer.tokenAmount));
      const time = escMd(timeAgo(buyer.timestamp));

      body += `*${i + 1}\\.* ${link}\n`;
      body += `  SOL: \`${sol}\`  Tokens: \`${tokens}\`  ${time}\n`;
    }

    if (buyers.length > 20) {
      body += `\n_\\.\\.\\. and ${buyers.length - 20} more buyers_`;
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
    console.error("Early command error:", err);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      "❌ Error fetching early buyer data. Please try again later."
    );
  }
}
