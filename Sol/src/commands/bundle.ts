import { Context } from "grammy";
import { detectBundledWallets } from "../services/helius_extended";
import { isValidSolanaAddress, shortenAddress } from "../utils/solana";
import { escMd, splitMessage } from "../utils/format";

export async function handleBundle(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const args = text.split(/\s+/).slice(1);

  if (args.length === 0) {
    await ctx.reply(
      "Usage: /bundle <contract>\n\nDetect if a token had bundled buys at launch."
    );
    return;
  }

  const mint = args[0];
  if (!isValidSolanaAddress(mint)) {
    await ctx.reply("❌ Invalid Solana address.");
    return;
  }

  const statusMsg = await ctx.reply("📦 Checking for bundled wallets...");

  try {
    const result = await detectBundledWallets(mint);

    let body = `*📦 Bundle Check*\n\n`;
    body += `Token: \`${escMd(mint.slice(0, 8))}\\.\\.\\.\`\n`;
    body += `\`${escMd(mint)}\`\n\n`;

    if (result.isBundled) {
      body += `*🚨 BUNDLED*\n\n`;
      body += `Bundle slot: \`${escMd(String(result.bundleSlot))}\`\n`;
      body += `Bundled wallets: *${escMd(String(result.totalBundled))}*\n\n`;
      body += `*Wallets:*\n`;

      for (let i = 0; i < result.bundledWallets.length; i++) {
        const w = result.bundledWallets[i];
        const shortW = escMd(shortenAddress(w, 6));
        const link = `[${shortW}](https://solscan\\.io/account/${escMd(w)})`;
        body += `${i + 1}\\. ${link}\n`;
      }
    } else {
      body += `*✅ NOT BUNDLED*\n\n`;
      body += `No suspicious coordinated buys detected at launch\\.\n`;
    }

    body += `\n_⚠️ Beta \\- may not be 100% accurate_`;

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
    console.error("Bundle command error:", err);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      "❌ Error checking bundle data. Please try again later."
    );
  }
}
