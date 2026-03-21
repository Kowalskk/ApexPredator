import { Context } from "grammy";
import { getTokenMetadata } from "../services/dexscreener";
import { isValidSolanaAddress } from "../utils/solana";
import { escMd } from "../utils/format";

export async function handleImg(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const args = text.split(/\s+/).slice(1);

  if (args.length === 0) {
    await ctx.reply(
      "Usage: /img <contract>\n\nReverse image search the token icon via Google Lens."
    );
    return;
  }

  const mint = args[0];
  if (!isValidSolanaAddress(mint)) {
    await ctx.reply("❌ Invalid Solana address.");
    return;
  }

  const statusMsg = await ctx.reply("🔍 Fetching token image...");

  try {
    const imageUrl = await getTokenMetadata(mint);

    if (!imageUrl) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        "❌ No token image found for this contract."
      );
      return;
    }

    const encodedUrl = encodeURIComponent(imageUrl);
    const lensUrl = `https://lens.google.com/uploadbyurl?url=${encodedUrl}`;

    const body =
      `*🖼️ Token Image*\n\n` +
      `Image URL:\n\`${escMd(imageUrl)}\`\n\n` +
      `[🔍 Reverse Image Search on Google Lens](${escMd(lensUrl)})\n\n` +
      `_Click the link above to do a reverse image search on Google Lens_`;

    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      body,
      { parse_mode: "MarkdownV2", link_preview_options: { is_disabled: true } }
    );
  } catch (err) {
    console.error("Img command error:", err);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      "❌ Error fetching token image. Please try again later."
    );
  }
}
