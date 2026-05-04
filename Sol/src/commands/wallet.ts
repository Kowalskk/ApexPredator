import { Context } from "grammy";
import { getWalletPnl } from "../services/helius_extended";
import { isValidSolanaAddress, shortenAddress } from "../utils/solana";
import { detectChain } from "../utils/evm";
import { handleEvmWallet } from "./evm_wallet";
import { escMd, splitMessage } from "../utils/format";

function fmtSol(sol: number): string {
  return `${sol >= 0 ? "+" : ""}${sol.toFixed(3)} SOL`;
}

function fmtUsd(usd: number): string {
  const sign = usd >= 0 ? "+" : "";
  if (Math.abs(usd) >= 1000) return `${sign}$${(usd / 1000).toFixed(1)}K`;
  return `${sign}$${usd.toFixed(0)}`;
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

export async function handleWallet(ctx: Context): Promise<void> {
  const text = ctx.message?.text || "";
  const args = text.split(/\s+/).slice(1);

  if (args.length === 0) {
    await ctx.reply("Usage: /wallet <address>\n\nAnalyze PnL, winrate, LP activity and transfers of a Solana wallet.");
    return;
  }

  const address = args[0];
  const chain = detectChain(address);

  if (!chain) {
    await ctx.reply("❌ Invalid address. Provide a Solana (base58) or EVM (0x...) address.");
    return;
  }

  // EVM chains — detect which one from optional second arg, default eth
  if (chain === "evm") {
    const evmChain = (args[1] || "eth").toLowerCase();
    return handleEvmWallet(ctx, address, evmChain);
  }

  if (!isValidSolanaAddress(address)) {
    await ctx.reply("❌ Invalid Solana address.");
    return;
  }

  const statusMsg = await ctx.reply("🔍 Analyzing wallet... (fetching swaps, transfers, LP activity)");

  try {
    const data = await getWalletPnl(address, 100);

    const short = shortenAddress(address, 4);
    const solscanLink = `[${escMd(short)}](https://solscan\\.io/account/${escMd(address)})`;

    const lines: string[] = [];

    // ── Header ──────────────────────────────────────────────────────────
    lines.push(`*💼 Wallet Analysis*`);
    lines.push(`${solscanLink}`);
    lines.push(`\`${escMd(address)}\``);
    lines.push("");

    // ── Summary ─────────────────────────────────────────────────────────
    const wr = data.winrate.toFixed(0);
    const wrEmoji = data.winrate >= 60 ? "🟢" : data.winrate >= 40 ? "🟡" : "🔴";
    const ratio = data.pnlRatio;
    const ratioStr = ratio >= 0 ? `${ratio.toFixed(2)}x` : `${ratio.toFixed(2)}x`;
    const ratioEmoji = ratio >= 1 ? "🚀" : ratio >= 0 ? "🟢" : ratio >= -0.3 ? "🟡" : "🔴";
    const styleEmoji: Record<string, string> = {
      scalper: "⚡",
      day: "📅",
      swing: "📈",
      holder: "💎",
      mixed: "🎲",
    };
    const holdStr = data.medianHoldingSeconds > 0
      ? (data.medianHoldingSeconds < 3600
          ? `${Math.floor(data.medianHoldingSeconds / 60)}m`
          : data.medianHoldingSeconds < 86400
          ? `${Math.floor(data.medianHoldingSeconds / 3600)}h`
          : `${Math.floor(data.medianHoldingSeconds / 86400)}d`)
      : "—";

    lines.push(`*📊 Summary*`);
    lines.push(`Trades \\(closed\\): *${data.totalTrades}* \\| Open: *${data.openPositions}*`);
    lines.push(`Winrate: ${wrEmoji} *${escMd(wr)}%* \\(${data.wins}W / ${data.losses}L\\)`);
    lines.push(`PnL ratio: ${ratioEmoji} *${escMd(ratioStr)}* \\(cost: \`${escMd(fmtUsd(data.totalCostUsd))}\`\\)`);
    lines.push(`Style: ${styleEmoji[data.tradingStyle] || "🎲"} *${escMd(data.tradingStyle)}* \\| median hold: \`${escMd(holdStr)}\``);
    lines.push(`SOL price: \`$${escMd(data.solPriceUsd.toFixed(2))}\``);
    lines.push("");

    // ── PnL breakdown ───────────────────────────────────────────────────
    lines.push(`*💰 PnL Breakdown*`);
    lines.push(`Swaps:  \`${escMd(fmtUsd(data.swapPnlUsd))}\` \\(${escMd(fmtSol(data.swapPnlSol))}\\)`);
    if (data.lpActivities.length > 0) {
      lines.push(`LP:     \`${escMd(fmtUsd(data.lpPnlUsd))}\` \\(${escMd(fmtSol(data.lpPnlSol))}\\)`);
    }
    const totalEmoji = data.totalPnlUsd >= 0 ? "🟢" : "🔴";
    lines.push(`${totalEmoji} *TOTAL: \`${escMd(fmtUsd(data.totalPnlUsd))}\`*`);
    lines.push("");

    // ── Top trades ──────────────────────────────────────────────────────
    if (data.trades.length > 0) {
      lines.push(`*🔄 Top Trades \\(by PnL\\)*`);
      const show = data.trades.slice(0, 10);
      for (const t of show) {
        const emoji = t.isOpen ? "🔓" : pnlEmoji(t.pnlUsd);
        const status = t.isOpen ? " _\\(open\\)_" : "";
        const sym = escMd(t.symbol.toUpperCase());
        const pnl = escMd(fmtUsd(t.pnlUsd));
        const solIn = escMd(t.solIn.toFixed(2));
        const solOut = escMd(t.solOut.toFixed(2));
        const ago = t.lastTimestamp ? escMd(timeAgo(t.lastTimestamp)) : "";
        lines.push(`${emoji} *${sym}*${status} \`${pnl}\``);
        lines.push(`  In: \`${solIn} SOL\` → Out: \`${solOut} SOL\`  _${ago}_`);
      }
      if (data.trades.length > 10) {
        lines.push(`_\\.\\.\\. and ${data.trades.length - 10} more trades_`);
      }
      lines.push("");
    }

    // ── LP Activity ──────────────────────────────────────────────────────
    if (data.lpActivities.length > 0) {
      lines.push(`*💧 LP Activity*`);
      for (const lp of data.lpActivities) {
        const emoji = pnlEmoji(lp.pnlUsd);
        const sym = escMd(lp.symbol.toUpperCase());
        const dep = escMd(lp.solDeposited.toFixed(2));
        const wit = escMd(lp.solWithdrawn.toFixed(2));
        const pnl = escMd(fmtUsd(lp.pnlUsd));
        lines.push(`${emoji} *${sym}*  \`${pnl}\``);
        lines.push(`  Deposited: \`${dep} SOL\` → Withdrawn: \`${wit} SOL\``);
      }
      lines.push("");
    }

    // ── Outgoing Transfers ───────────────────────────────────────────────
    if (data.outgoingTransfers.length > 0) {
      lines.push(`*📤 Outgoing Transfers*`);
      lines.push(`_\\(tokens sent out — profit may be in destination wallet\\)_`);
      const showT = data.outgoingTransfers.slice(0, 5);
      for (const t of showT) {
        const sym = escMd(t.symbol.toUpperCase());
        const amt = t.amount >= 1_000_000
          ? `${(t.amount / 1_000_000).toFixed(1)}M`
          : t.amount >= 1_000
          ? `${(t.amount / 1_000).toFixed(1)}K`
          : t.amount.toFixed(0);
        const toShort = escMd(shortenAddress(t.toAddress, 4));
        const toLink = `[${toShort}](https://solscan\\.io/account/${escMd(t.toAddress)})`;
        lines.push(`⚠️ *${sym}* \`${escMd(amt)}\` → ${toLink}`);
        lines.push(`\`${escMd(t.toAddress)}\``);
      }
      if (data.outgoingTransfers.length > 5) {
        lines.push(`_\\.\\.\\. and ${data.outgoingTransfers.length - 5} more transfers_`);
      }
    }

    const fullText = lines.join("\n");
    const parts = splitMessage(fullText, 3800);

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
    console.error("Wallet command error:", err);
    await ctx.api.editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      "❌ Error analyzing wallet. Please try again later."
    );
  }
}
