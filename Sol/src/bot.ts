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

  const helpText =
    "🐺 <b>ApexPredator — Multi-chain Analytics</b>\n\n" +
    "<b>🔍 Wallet Analysis</b>\n" +
    "/wallet <code>&lt;address&gt;</code> — PnL, winrate, trades (Solana or EVM)\n" +
    "  EVM: add chain after address: <code>/wallet 0x... base</code>\n" +
    "  Chains: <code>eth</code> · <code>bsc</code> · <code>base</code> · <code>arbitrum</code>\n\n" +
    "<b>🐋 Holders</b>\n" +
    "/top20 <code>&lt;ca&gt;</code> — Top 20 holders + portfolio (Solana or EVM)\n" +
    "/top50 <code>&lt;ca&gt;</code> — Top 50 holders + portfolio\n" +
    "/kol <code>&lt;ca1&gt; &lt;ca2&gt; [ca3]</code> — Wallets holding all tokens\n\n" +
    "<b>🎯 Launch Analysis</b>\n" +
    "/bundle <code>&lt;ca&gt;</code> — Detect bundled buys at launch\n" +
    "/snipers <code>&lt;ca1&gt; &lt;ca2&gt; ...</code> — Cabal sniper clustering\n" +
    "/early <code>&lt;ca&gt;</code> — First buyers (pump.fun)\n" +
    "/fresh <code>&lt;ca&gt;</code> — Fresh wallets among top holders\n" +
    "/funded <code>&lt;ca&gt;</code> — Shared funders among top holders\n\n" +
    "<b>📊 Token Info</b>\n" +
    "/dex <code>&lt;ca&gt;</code> — Price, mcap, vol, liquidity (DexScreener)\n" +
    "/hmap — Market heatmap (24h)\n" +
    "/graduated — Recent pump.fun graduates\n" +
    "/img <code>&lt;ca&gt;</code> — Reverse image search token icon\n" +
    "/hscan <code>&lt;ca&gt;</code> — Holder count history";

  bot.command("start", async (ctx) => {
    await ctx.reply(helpText, { parse_mode: "HTML" });
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(helpText, { parse_mode: "HTML" });
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
