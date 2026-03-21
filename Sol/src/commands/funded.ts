import { Context } from "grammy";
import { getTopHolders } from "../services/helius";
import { getWalletFirstFunder } from "../services/helius_extended";
import { isValidSolanaAddress, shortenAddress } from "../utils/solana";
import { escMd, splitMessage } from "../utils/format";
import { FunderInfo } from "../types";

export async function handleFunded(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const args = text.split(/\s+/).slice(1);

  if (args.length === 0) {
    await ctx.reply(
      "Usage: /funded <contract>\n\nAnalyze funding sources of the top 30 holders."
    );
    return;
  }

  const mint = args[0];
  if (!isValidSolanaAddress(mint)) {
    await ctx.reply("❌ Invalid Solana address.");
    return;
  }

  const statusMsg = await ctx.reply("💰 Analyzing wallet funding sources...");

  try {
    const holders = await getTopHolders(mint, 30);

    if (holders.length === 0) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        "No holders found for this token."
      );
      return;
    }

    // Get funder for each holder
    const holderFunders: { holder: string; funderInfo: FunderInfo }[] = [];
    for (const holder of holders) {
      const funderInfo = await getWalletFirstFunder(holder.owner);
      holderFunders.push({ holder: holder.owner, funderInfo });
      await new Promise((r) => setTimeout(r, 300)); // throttle
    }

    // Group by funder wallet
    const funderMap = new Map<string, string[]>();
    for (const { holder, funderInfo } of holderFunders) {
      const key = funderInfo.funder || "UNKNOWN";
      if (!funderMap.has(key)) {
        funderMap.set(key, []);
      }
      funderMap.get(key)!.push(holder);
    }

    // Sort by most connections first
    const sorted = Array.from(funderMap.entries())
      .sort((a, b) => b[1].length - a[1].length);

    let body = `*💰 Wallet Funding Analysis*\n\n`;
    body += `Token: \`${escMd(mint.slice(0, 8))}\\.\\.\\.\`\n`;
    body += `Holders analyzed: *${escMd(String(holders.length))}*\n\n`;

    let hasRedFlag = false;

    for (const [funder, fundedHolders] of sorted) {
      if (funder === "UNKNOWN") continue;

      const isMultiple = fundedHolders.length > 1;
      if (isMultiple) hasRedFlag = true;

      const flagEmoji = isMultiple ? "🚨" : "✅";
      const funderShort = escMd(shortenAddress(funder, 6));
      const funderLink = `[${funderShort}](https://solscan\\.io/account/${escMd(funder)})`;

      body += `${flagEmoji} *Funder:* ${funderLink}\n`;
      body += `  Funded *${escMd(String(fundedHolders.length))}* holder${fundedHolders.length > 1 ? "s" : ""}:\n`;

      for (const holderAddr of fundedHolders) {
        const hShort = escMd(shortenAddress(holderAddr, 6));
        const hLink = `[${hShort}](https://solscan\\.io/account/${escMd(holderAddr)})`;
        body += `    → ${hLink}\n`;
      }
      body += "\n";
    }

    if (hasRedFlag) {
      body += `⚠️ *Multiple holders were funded by the same wallet \\— possible coordination\\.*\n`;
    } else {
      body += `✅ *No shared funders detected among top holders\\.*\n`;
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
    console.error("Funded command error:", err);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      "❌ Error fetching funding data. Please try again later."
    );
  }
}
