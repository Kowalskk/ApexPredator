import { Context } from "grammy";
import { isValidSolanaAddress } from "../utils/solana";
import { escMd, splitMessage } from "../utils/format";
import { cacheGet, cacheSet } from "../utils/cache";
import { config } from "../config";

interface HolderHistoryEntry {
  timestamp: number;
  holderCount: number;
}

async function fetchHolderHistory(mint: string): Promise<HolderHistoryEntry[] | null> {
  const cacheKey = `hscan:${mint}`;
  const cached = cacheGet<HolderHistoryEntry[]>(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetch(`https://holderscan.io/api/tokens/${mint}/holders/history`);
    if (!res.ok) return null;

    const json = (await res.json()) as any;
    if (!Array.isArray(json) || json.length === 0) return null;

    const data: HolderHistoryEntry[] = json.map((entry: any) => ({
      timestamp: entry.timestamp || entry.date || 0,
      holderCount: entry.holder_count || entry.holderCount || 0,
    }));

    cacheSet(cacheKey, data, config.cacheTtl);
    return data;
  } catch {
    return null;
  }
}

function timeAgo(timestamp: number): string {
  const seconds = Math.floor(Date.now() / 1000) - timestamp;
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export async function handleHscan(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const args = text.split(/\s+/).slice(1);

  if (args.length === 0) {
    await ctx.reply(
      "Usage: /hscan <contract>\n\nCheck holder count history for a token."
    );
    return;
  }

  const mint = args[0];
  if (!isValidSolanaAddress(mint)) {
    await ctx.reply("❌ Invalid Solana address.");
    return;
  }

  const statusMsg = await ctx.reply("📊 Fetching holder history...");

  try {
    const history = await fetchHolderHistory(mint);

    if (!history) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        `*📊 Holder Scan*\n\n` +
          `Holder history for this token is not yet indexed\\.\n\n` +
          `For fresh tokens, check back in a few hours\\.\n\n` +
          `_Powered by [holderscan\\.io](https://holderscan.io)_`,
        { parse_mode: "MarkdownV2", link_preview_options: { is_disabled: true } }
      );
      return;
    }

    // Show up to 10 most recent data points
    const recent = history.slice(-10);
    const first = history[0];
    const last = history[history.length - 1];

    let body = `*📊 Holder Scan*\n\n`;
    body += `Token: \`${escMd(mint.slice(0, 8))}\\.\\.\\.\`\n\n`;
    body += `First recorded: \`${escMd(String(first.holderCount))}\` holders \\(${escMd(timeAgo(first.timestamp))}\\)\n`;
    body += `Latest: \`${escMd(String(last.holderCount))}\` holders \\(${escMd(timeAgo(last.timestamp))}\\)\n\n`;

    body += `*Holder Trend:*\n`;
    for (const entry of recent) {
      const count = escMd(String(entry.holderCount));
      const time = escMd(timeAgo(entry.timestamp));
      body += `\`${count}\` holders — ${time}\n`;
    }

    body += `\n_Powered by [holderscan\\.io](https://holderscan.io)_`;

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
    console.error("Hscan command error:", err);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      "❌ Error fetching holder data. Please try again later."
    );
  }
}
