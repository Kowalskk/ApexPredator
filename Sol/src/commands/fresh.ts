import { Context } from "grammy";
import { getTopHolders } from "../services/helius";
import { checkWalletAge } from "../services/helius_extended";
import { isValidSolanaAddress, shortenAddress } from "../utils/solana";
import { escMd, splitMessage } from "../utils/format";
import { WalletAgeInfo } from "../types";

export async function handleFresh(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const args = text.split(/\s+/).slice(1);

  if (args.length === 0) {
    await ctx.reply(
      "Usage: /fresh <contract>\n\nAnalyze how many top 50 holders are fresh wallets."
    );
    return;
  }

  const mint = args[0];
  if (!isValidSolanaAddress(mint)) {
    await ctx.reply("❌ Invalid Solana address.");
    return;
  }

  const statusMsg = await ctx.reply("🔍 Analyzing holder wallet ages...");

  try {
    const holders = await getTopHolders(mint, 50);

    if (holders.length === 0) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        "No holders found for this token."
      );
      return;
    }

    // Check each holder's age
    const ageResults: WalletAgeInfo[] = [];
    for (const holder of holders) {
      const info = await checkWalletAge(holder.owner);
      ageResults.push(info);
      await new Promise((r) => setTimeout(r, 200)); // throttle
    }

    const freshWallets = ageResults.filter((w) => w.isFresh);
    const freshPct = holders.length > 0
      ? Math.round((freshWallets.length / ageResults.length) * 100)
      : 0;

    let body = `*🆕 Fresh Wallet Analysis*\n\n`;
    body += `Token: \`${escMd(mint.slice(0, 8))}\\.\\.\\.\`\n`;
    body += `Holders analyzed: *${escMd(String(ageResults.length))}*\n\n`;

    if (freshWallets.length === 0) {
      body += `✅ No fresh wallets found among top holders\\.\n`;
    } else {
      body += `*Fresh Wallets:*\n`;
      body += `${"─".repeat(30)}\n`;

      for (let i = 0; i < ageResults.length; i++) {
        const info = ageResults[i];
        const rank = i + 1;
        const shortAddr = escMd(shortenAddress(info.address, 6));
        const solscanLink = `[${shortAddr}](https://solscan\\.io/account/${escMd(info.address)})`;
        const txCountStr = escMd(String(info.txCount));
        const statusEmoji = info.isFresh ? "🆕 FRESH" : "✅ OLD";

        if (info.isFresh) {
          body += `\n*${rank}\\.* ${solscanLink}\n`;
          body += `  Txs: \`${txCountStr}\`  Status: ${statusEmoji}\n`;
        }
      }
    }

    body += `\n${"─".repeat(30)}\n`;
    body += `*${escMd(String(freshWallets.length))} of ${escMd(String(ageResults.length))} top holders are fresh wallets \\(${escMd(String(freshPct))}%\\)*`;

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
    console.error("Fresh command error:", err);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      "❌ Error fetching holder data. Please try again later."
    );
  }
}
