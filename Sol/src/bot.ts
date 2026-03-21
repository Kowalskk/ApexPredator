import { Bot } from "grammy";
import { config } from "./config";
import { handleKol } from "./commands/kol";
import { handleTop20 } from "./commands/top20";
import { handleTop50 } from "./commands/top50";
import { handleWallet } from "./commands/wallet";
import { handleFresh } from "./commands/fresh";
import { handleFunded } from "./commands/funded";
import { handleBundle } from "./commands/bundle";
import { handleEarly } from "./commands/early";
import { handleDex } from "./commands/dex";
import { handleHmap } from "./commands/hmap";
import { handleGraduated } from "./commands/graduated";
import { handleTwitter } from "./commands/twitter";
import { handleSite } from "./commands/site";
import { handleImg } from "./commands/img";
import { handleHscan } from "./commands/hscan";

export function createBot(): Bot {
  const bot = new Bot(config.telegramBotToken);

  // Start command
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "🐺 *ApexPredator\\_sol*\n\n" +
        "Solana on\\-chain analytics bot\\.\n\n" +
        "*Commands:*\n" +
        "/kol `<ca1> <ca2> [ca3]` \\- Find wallets that traded all given tokens\n" +
        "/top20 `<ca>` \\- Top 20 holders \\+ their portfolio\n" +
        "/top50 `<ca>` \\- Top 50 holders \\+ their portfolio\n" +
        "/wallet `<address>` \\- Analyze wallet swap history\n" +
        "/fresh `<ca>` \\- Detect fresh wallets among top holders\n" +
        "/funded `<ca>` \\- Analyze wallet funding sources\n" +
        "/bundle `<ca>` \\- Detect bundled buys at launch\n" +
        "/early `<ca>` \\- First buyers of a pump\\.fun token\n" +
        "/dex `<ca>` \\- Token info from DEXScreener\n" +
        "/hmap \\- Market heatmap \\(24h\\)\n" +
        "/graduated \\- Recently graduated pump\\.fun tokens\n" +
        "/twitter `<handle>` \\- Twitter handle history\n" +
        "/site `<url>` \\- Website similarity check\n" +
        "/img `<ca>` \\- Reverse image search token icon\n" +
        "/hscan `<ca>` \\- Holder count history\n" +
        "/help \\- Show this message",
      { parse_mode: "MarkdownV2" }
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "🐺 *ApexPredator\\_sol Commands*\n\n" +
        "*On\\-chain Analysis:*\n" +
        "/kol `<ca1> <ca2> [ca3]`\n" +
        "  Find wallets that hold/traded ALL given tokens \\(max 3\\)\n\n" +
        "/top20 `<contract>`\n" +
        "  Top 20 holders of a token \\+ their holdings\n\n" +
        "/top50 `<contract>`\n" +
        "  Top 50 holders of a token \\+ their holdings\n\n" +
        "/wallet `<address>`\n" +
        "  Analyze swap history of a wallet\n\n" +
        "/fresh `<contract>`\n" +
        "  Check how many top holders are fresh wallets\n\n" +
        "/funded `<contract>`\n" +
        "  Analyze funding sources of top holders\n\n" +
        "/bundle `<contract>`\n" +
        "  Detect bundled buys at token launch\n\n" +
        "/early `<contract>`\n" +
        "  First buyers of a pump\\.fun token\n\n" +
        "*Token Info:*\n" +
        "/dex `<contract>`\n" +
        "  Token info from DEXScreener\n\n" +
        "/hmap\n" +
        "  Market heatmap \\(top 30 coins, 24h change\\)\n\n" +
        "/graduated\n" +
        "  Recently graduated pump\\.fun tokens\n\n" +
        "/img `<contract>`\n" +
        "  Reverse image search the token icon\n\n" +
        "/hscan `<contract>`\n" +
        "  Holder count history\n\n" +
        "*Research Tools:*\n" +
        "/twitter `<handle>`\n" +
        "  Twitter handle history \\(coming soon\\)\n\n" +
        "/site `<url>`\n" +
        "  Website similarity check \\(coming soon\\)",
      { parse_mode: "MarkdownV2" }
    );
  });

  // Register command handlers
  bot.command("kol", handleKol);
  bot.command("top20", handleTop20);
  bot.command("top50", handleTop50);
  bot.command("wallet", handleWallet);
  bot.command("fresh", handleFresh);
  bot.command("funded", handleFunded);
  bot.command("bundle", handleBundle);
  bot.command("early", handleEarly);
  bot.command("dex", handleDex);
  bot.command("hmap", handleHmap);
  bot.command("graduated", handleGraduated);
  bot.command("twitter", handleTwitter);
  bot.command("site", handleSite);
  bot.command("img", handleImg);
  bot.command("hscan", handleHscan);

  // Error handler
  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  return bot;
}
