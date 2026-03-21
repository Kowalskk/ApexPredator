import { Context } from "grammy";

export async function handleSite(ctx: Context): Promise<void> {
  await ctx.reply(
    `*🌐 Site Check*\n\n` +
      `This feature \\(website template similarity detection\\) is coming soon\\.\n\n` +
      `For now, try manually checking:\n` +
      `\\- [sitelike\\.org](https://www.sitelike.org)\n` +
      `\\- [SimilarWeb](https://www.similarweb.com)`,
    { parse_mode: "MarkdownV2", link_preview_options: { is_disabled: true } }
  );
}
