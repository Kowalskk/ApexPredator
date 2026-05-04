import { Context } from "grammy";
import { getEvmTopHolders } from "../services/moralis";
import { getTokenInfo } from "../services/dexscreener";
import { shortenEvmAddress, escHtml } from "../utils/evm";
import { splitMessage } from "../utils/format";

const CHAIN_EXPLORERS: Record<string, string> = {
  eth: "https://etherscan.io/address/",
  bsc: "https://bscscan.com/address/",
  base: "https://basescan.org/address/",
  arbitrum: "https://arbiscan.io/address/",
};

const CHAIN_LABELS: Record<string, string> = {
  eth: "Ethereum", bsc: "BSC", base: "Base", arbitrum: "Arbitrum",
};

export async function handleEvmTop(
  ctx: Context,
  tokenAddress: string,
  chain: string,
  limit: number
): Promise<void> {
  const statusMsg = await ctx.reply(
    `🔍 Fetching top ${limit} holders on ${CHAIN_LABELS[chain] || chain}...`
  );

  try {
    const [holders, tokenInfo] = await Promise.all([
      getEvmTopHolders(tokenAddress, chain, limit),
      getTokenInfo(tokenAddress).catch(() => null),
    ]);

    if (holders.length === 0) {
      await ctx.api.editMessageText(
        ctx.chat!.id, statusMsg.message_id,
        "❌ No holders found. Check the contract address."
      );
      return;
    }

    const symbol  = tokenInfo?.symbol  || "???";
    const name    = tokenInfo?.name    || "Unknown";
    const explorer = CHAIN_EXPLORERS[chain] || "https://etherscan.io/address/";
    const chainLabel = CHAIN_LABELS[chain] || chain;
    const short = shortenEvmAddress(tokenAddress, 4);

    const lines: string[] = [];
    lines.push(`🐋 <b>Top ${limit} Holders — ${escHtml(symbol)} [${escHtml(chainLabel)}]</b>`);
    lines.push(`${escHtml(name)} · <a href="${explorer}${tokenAddress}">${escHtml(short)}</a>`);
    lines.push(`<code>${escHtml(tokenAddress)}</code>`);
    lines.push("");

    for (let i = 0; i < holders.length; i++) {
      const h = holders[i];
      const pct = h.percentageRelativeToTotalSupply.toFixed(2);
      const pctNum = h.percentageRelativeToTotalSupply;
      const sizeEmoji = pctNum >= 5 ? "🐋" : pctNum >= 2 ? "🦈" : pctNum >= 0.5 ? "🐟" : "·";
      const addrShort = shortenEvmAddress(h.ownerAddress, 4);
      const usd = h.usdValue >= 1000
        ? `$${(h.usdValue / 1000).toFixed(1)}K`
        : `$${h.usdValue.toFixed(0)}`;

      lines.push(
        `${i + 1}. ${sizeEmoji} <a href="${explorer}${h.ownerAddress}">${escHtml(addrShort)}</a> — <b>${escHtml(pct)}%</b> · <code>${escHtml(usd)}</code>`
      );
      lines.push(`<code>${escHtml(h.ownerAddress)}</code>`);
    }

    const fullText = lines.join("\n");
    const parts = splitMessage(fullText, 3800);

    await ctx.api.editMessageText(
      ctx.chat!.id, statusMsg.message_id, parts[0],
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
    );
    for (let i = 1; i < parts.length; i++) {
      await ctx.reply(parts[i], {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    }
  } catch (err) {
    console.error("EVM top holders error:", err);
    await ctx.api.editMessageText(
      ctx.chat!.id, statusMsg.message_id,
      "❌ Error fetching holders. Check address and chain."
    );
  }
}
