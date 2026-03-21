import { Context } from "grammy";
import { escMd } from "../utils/format";

function isValidTwitterHandle(handle: string): boolean {
  // Twitter handle: 1-15 chars, alphanumeric + underscore
  return /^@?[A-Za-z0-9_]{1,15}$/.test(handle);
}

export async function handleTwitter(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const args = text.split(/\s+/).slice(1);

  if (args.length === 0) {
    await ctx.reply(
      "Usage: /twitter <handle>\n\nExample: /twitter elonmusk"
    );
    return;
  }

  const handle = args[0].replace(/^@/, "");

  if (!isValidTwitterHandle(handle)) {
    await ctx.reply(
      "❌ Invalid Twitter handle. Handles must be 1-15 characters (letters, numbers, underscores)."
    );
    return;
  }

  await ctx.reply(
    `*🐦 Twitter History*\n\n` +
      `This feature requires special Twitter API access\\.\n\n` +
      `We'll add this soon\\! In the meantime, you can check:\n` +
      `\\- [memory\\.lol](https://memory.lol) \\(username history tracker\\)\n` +
      `\\- [Twitter/X](https://x\\.com/${escMd(handle)}) \\(direct profile\\)`,
    { parse_mode: "MarkdownV2", link_preview_options: { is_disabled: true } }
  );
}
