import { Context } from "grammy";
import { getEvmWalletPnl } from "../services/evm_pnl";
import { shortenEvmAddress, escHtml } from "../utils/evm";
import { splitMessage } from "../utils/format";
import { EvmTokenTrade } from "../types";

const CHAIN_LABELS: Record<string, string> = {
  eth: "Ethereum",
  bsc: "BSC",
  base: "Base",
  arbitrum: "Arbitrum",
};

const CHAIN_EXPLORERS: Record<string, string> = {
  eth: "https://etherscan.io/address/",
  bsc: "https://bscscan.com/address/",
  base: "https://basescan.org/address/",
  arbitrum: "https://arbiscan.io/address/",
};

const NATIVE_SYM: Record<string, string> = {
  eth: "ETH",
  bsc: "BNB",
  base: "ETH",
  arbitrum: "ETH",
};

function fmtUsd(usd: number): string {
  const sign = usd >= 0 ? "+" : "";
  if (Math.abs(usd) >= 1_000_000) return `${sign}$${(usd / 1_000_000).toFixed(2)}M`;
  if (Math.abs(usd) >= 1_000) return `${sign}$${(usd / 1_000).toFixed(1)}K`;
  return `${sign}$${usd.toFixed(0)}`;
}

function fmtNative(amount: number, sym: string): string {
  return `${amount >= 0 ? "+" : ""}${amount.toFixed(3)} ${sym}`;
}

function pnlEmoji(usd: number): string {
  return usd > 0 ? "✅" : usd < 0 ? "❌" : "⚪";
}

function timeAgo(ts: number): string {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function holdStr(sec: number): string {
  if (sec <= 0) return "—";
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

const STYLE_EMOJI: Record<string, string> = {
  scalper: "⚡", day: "📅", swing: "📈", holder: "💎", mixed: "🎲",
};

export async function handleEvmWallet(ctx: Context, address: string, chain: string): Promise<void> {
  const statusMsg = await ctx.reply(
    `🔍 Analyzing ${CHAIN_LABELS[chain] || chain} wallet... (fetching swaps & transfers)`
  );

  try {
    const data = await getEvmWalletPnl(address, chain);
    const sym = NATIVE_SYM[chain] || "ETH";
    const explorer = CHAIN_EXPLORERS[chain] || "https://etherscan.io/address/";
    const short = shortenEvmAddress(address, 4);
    const chainLabel = CHAIN_LABELS[chain] || chain;

    const lines: string[] = [];

    // ── Header ────────────────────────────────────────────────────────────────
    lines.push(`💼 <b>Wallet Analysis [${escHtml(chainLabel)}]</b>`);
    lines.push(`<a href="${explorer}${address}">${escHtml(short)}</a>`);
    lines.push(`<code>${escHtml(address)}</code>`);
    lines.push("");

    // ── Summary ───────────────────────────────────────────────────────────────
    const wr = data.winrate.toFixed(0);
    const wrEmoji = data.winrate >= 60 ? "🟢" : data.winrate >= 40 ? "🟡" : "🔴";
    const ratio = data.pnlRatio;
    const ratioStr = `${ratio >= 0 ? "+" : ""}${(ratio * 100).toFixed(1)}%`;
    const ratioEmoji = ratio >= 0.5 ? "🚀" : ratio >= 0 ? "🟢" : ratio >= -0.3 ? "🟡" : "🔴";
    const style = data.tradingStyle;

    lines.push(`📊 <b>Summary</b>`);
    lines.push(`Trades (closed): <b>${data.totalTrades}</b> | Open: <b>${data.openPositions}</b>`);
    lines.push(`Winrate: ${wrEmoji} <b>${wr}%</b> (${data.wins}W / ${data.losses}L)`);
    lines.push(`PnL ratio: ${ratioEmoji} <b>${escHtml(ratioStr)}</b> (cost: <code>${escHtml(fmtUsd(data.totalCostUsd))}</code>)`);
    lines.push(`Style: ${STYLE_EMOJI[style] || "🎲"} <b>${escHtml(style)}</b> | median hold: <code>${holdStr(data.medianHoldingSeconds)}</code>`);
    lines.push(`${escHtml(sym)} price: <code>$${data.nativePriceUsd.toFixed(2)}</code>`);
    lines.push("");

    // ── PnL ───────────────────────────────────────────────────────────────────
    const totalEmoji = data.totalPnlUsd >= 0 ? "🟢" : "🔴";
    lines.push(`💰 <b>PnL Breakdown</b>`);
    lines.push(`${totalEmoji} <b>TOTAL: <code>${escHtml(fmtUsd(data.totalPnlUsd))}</code></b>`);
    lines.push("");

    // ── Top trades ────────────────────────────────────────────────────────────
    if (data.trades.length > 0) {
      lines.push(`🔄 <b>Top Trades (by PnL)</b>`);
      const show = data.trades.slice(0, 10);
      for (const t of show) {
        const emoji = t.isOpen ? "🔓" : pnlEmoji(t.pnlUsd);
        const status = t.isOpen ? " <i>(open)</i>" : "";
        const pnl = escHtml(fmtUsd(t.pnlUsd));
        const native = escHtml(fmtNative(t.ethOut - t.ethIn, sym));
        const ago = t.lastTs ? escHtml(timeAgo(t.lastTs)) : "";
        lines.push(`${emoji} <b>${escHtml(t.symbol.toUpperCase())}</b>${status} <code>${pnl}</code>`);
        lines.push(`  In: <code>${escHtml(fmtUsd(t.usdIn))}</code> → Out: <code>${escHtml(fmtUsd(t.usdOut))}</code>  <i>${ago}</i>`);
      }
      if (data.trades.length > 10) {
        lines.push(`<i>... and ${data.trades.length - 10} more trades</i>`);
      }
      lines.push("");
    }

    // ── Outgoing transfers ────────────────────────────────────────────────────
    if (data.outgoingTransfers.length > 0) {
      lines.push(`📤 <b>Outgoing Transfers</b>`);
      lines.push(`<i>(tokens sent out — profit may be in destination wallet)</i>`);
      for (const t of data.outgoingTransfers.slice(0, 5)) {
        const toShort = shortenEvmAddress(t.toAddress, 4);
        lines.push(`⚠️ <b>${escHtml(t.symbol.toUpperCase())}</b> <code>${t.amount.toFixed(0)}</code> → <a href="${explorer}${t.toAddress}">${escHtml(toShort)}</a>`);
        lines.push(`<code>${escHtml(t.toAddress)}</code>`);
      }
      if (data.outgoingTransfers.length > 5) {
        lines.push(`<i>... and ${data.outgoingTransfers.length - 5} more</i>`);
      }
    }

    const fullText = lines.join("\n");
    const parts = splitMessage(fullText, 3800);

    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      parts[0],
      { parse_mode: "HTML", link_preview_options: { is_disabled: true } }
    );

    for (let i = 1; i < parts.length; i++) {
      await ctx.reply(parts[i], {
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    }
  } catch (err) {
    console.error("EVM wallet error:", err);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      "❌ Error analyzing EVM wallet. Check address and try again."
    );
  }
}
