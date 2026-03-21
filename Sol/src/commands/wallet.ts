import { Context } from "grammy";
import { getWalletSwapHistory } from "../services/helius_extended";
import { isValidSolanaAddress, shortenAddress } from "../utils/solana";
import { escMd, formatAmount, splitMessage } from "../utils/format";
import { SwapTransaction } from "../types";

export async function handleWallet(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const args = text.split(/\s+/).slice(1);

  if (args.length === 0) {
    await ctx.reply(
      "Usage: /wallet <address>\n\nAnalyze the swap history of a Solana wallet."
    );
    return;
  }

  const address = args[0];
  if (!isValidSolanaAddress(address)) {
    await ctx.reply("❌ Invalid Solana address.");
    return;
  }

  const statusMsg = await ctx.reply("🔍 Analyzing wallet...");

  try {
    const swaps = await getWalletSwapHistory(address, 100);

    if (swaps.length === 0) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        "No swap history found for this wallet."
      );
      return;
    }

    // Sort by total activity (bought + sold) descending, take top 15
    const top15: SwapTransaction[] = swaps
      .sort((a, b) => (b.bought + b.sold) - (a.bought + a.sold))
      .slice(0, 15);

    const shortAddr = shortenAddress(address, 6);
    const solscanLink = `[${escMd(shortAddr)}](https://solscan\\.io/account/${escMd(address)})`;

    let body = `*💼 Wallet Analysis*\n\n`;
    body += `Address: ${solscanLink}\n`;
    body += `Tokens traded: *${escMd(String(swaps.length))}*\n\n`;
    body += `*Top ${top15.length} Tokens by Activity:*\n`;
    body += `${"─".repeat(30)}\n`;

    for (let i = 0; i < top15.length; i++) {
      const swap = top15[i];
      const symbol = escMd(swap.symbol || swap.mint.slice(0, 8));
      const bought = escMd(formatAmount(swap.bought));
      const sold = escMd(formatAmount(swap.sold));
      const holding = swap.bought - swap.sold;
      const holdingStr = holding > 0
        ? escMd(`+${formatAmount(holding)}`)
        : escMd(formatAmount(holding));

      body += `\n*${i + 1}\\.* ${symbol}\n`;
      body += `  Bought: \`${bought}\`  Sold: \`${sold}\`\n`;
      body += `  Est\\. holding: \`${holdingStr}\`\n`;
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
    console.error("Wallet command error:", err);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      "❌ Error fetching wallet data. Please try again later."
    );
  }
}
