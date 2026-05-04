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
import { handleSnipers } from "./commands/snipers";

export function createBot(): Bot {
  const bot = new Bot(config.telegramBotToken);

  // Start command
  bot.command("start", async (ctx) => {
    await ctx.reply(
      "🐺 <b>ApexPredator_sol</b>\n\n" +
        "Solana on-chain analytics bot.\n\n" +
        "<b>Commands:</b>\n" +
        "/kol <code>&lt;ca1&gt; &lt;ca2&gt; [ca3]</code> - Find wallets that hold all given tokens\n" +
        "/top20 <code>&lt;ca&gt;</code> - Top 20 holders + their portfolio\n" +
        "/top50 <code>&lt;ca&gt;</code> - Top 50 holders + their portfolio\n" +
        "/wallet <code>&lt;address&gt;</code> - Analyze wallet swap history\n" +
        "/fresh <code>&lt;ca&gt;</code> - Detect fresh wallets among top holders\n" +
        "/funded <code>&lt;ca&gt;</code> - Analyze wallet funding sources\n" +
        "/bundle <code>&lt;ca&gt;</code> - Detect bundled buys at launch\n" +
        "/early <code>&lt;ca&gt;</code> - First buyers of a pump.fun token\n" +
        "/dex <code>&lt;ca&gt;</code> - Token info from DEXScreener\n" +
        "/hmap - Market heatmap (24h)\n" +
        "/graduated - Recently graduated pump.fun tokens\n" +
        "/twitter <code>&lt;handle&gt;</code> - Twitter handle history\n" +
        "/site <code>&lt;url&gt;</code> - Website similarity check\n" +
        "/img <code>&lt;ca&gt;</code> - Reverse image search token icon\n" +
        "/hscan <code>&lt;ca&gt;</code> - Holder count history\n" +
        "/snipers <code>&lt;ca1&gt; &lt;ca2&gt; ...</code> - Cabal sniper clustering\n" +
        "/help - Show this message",
      { parse_mode: "HTML" }
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "🐺 <b>ApexPredator_sol Commands</b>\n\n" +
        "<b>On-chain Analysis:</b>\n" +
        "/kol <code>&lt;ca1&gt; &lt;ca2&gt; [ca3]</code>\n" +
        "  Find wallets that hold ALL given tokens (max 3)\n\n" +
        "/top20 <code>&lt;contract&gt;</code> - Top 20 holders + holdings\n" +
        "/top50 <code>&lt;contract&gt;</code> - Top 50 holders + holdings\n" +
        "/wallet <code>&lt;address&gt;</code> - Swap history of a wallet\n" +
        "/fresh <code>&lt;contract&gt;</code> - Fresh wallets among top holders\n" +
        "/funded <code>&lt;contract&gt;</code> - Funding sources of top holders\n" +
        "/bundle <code>&lt;contract&gt;</code> - Detect bundled buys at launch\n" +
        "/early <code>&lt;contract&gt;</code> - First buyers of pump.fun token\n\n" +
        "<b>Token Info:</b>\n" +
        "/dex <code>&lt;contract&gt;</code> - DEXScreener info\n" +
        "/hmap - Market heatmap (top 30, 24h)\n" +
        "/graduated - Recently graduated pump.fun tokens\n" +
        "/img <code>&lt;contract&gt;</code> - Reverse image search token icon\n" +
        "/hscan <code>&lt;contract&gt;</code> - Holder count history\n\n" +
        "<b>Research Tools:</b>\n" +
        "/twitter <code>&lt;handle&gt;</code> - Twitter history (stub)\n" +
        "/site <code>&lt;url&gt;</code> - Website similarity (stub)",
      { parse_mode: "HTML" }
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
  bot.command("snipers", handleSnipers);

  // Error handler
  bot.catch((err) => {
    console.error("Bot error:", err);
  });

  return bot;
}
