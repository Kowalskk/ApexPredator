import { TokenHolding } from "../types";
import { shortenAddress } from "./solana";

// Escape characters for Telegram MarkdownV2
export function escMd(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

export function formatUsd(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(2)}K`;
  return `$${value.toFixed(2)}`;
}

export function formatAmount(amount: number): string {
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(2)}B`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(2)}K`;
  return amount.toFixed(2);
}

export function formatWalletList(wallets: string[], maxShow = 50): string {
  const lines = wallets.slice(0, maxShow).map(
    (w, i) => `${i + 1}\\. \`${escMd(shortenAddress(w, 6))}\` [Full](https://solscan\\.io/account/${escMd(w)})`
  );
  if (wallets.length > maxShow) {
    lines.push(`\n_\\.\\.\\. and ${wallets.length - maxShow} more_`);
  }
  return lines.join("\n");
}

export function formatHoldings(holdings: TokenHolding[]): string {
  if (holdings.length === 0) return "_No holdings \\> $5_";
  return holdings
    .sort((a, b) => b.usdValue - a.usdValue)
    .slice(0, 10)
    .map((h) => `  ${escMd(h.symbol || "???")} \\- ${escMd(formatUsd(h.usdValue))}`)
    .join("\n");
}

// Split long messages for Telegram's 4096 char limit
export function splitMessage(text: string, maxLen = 4000): string[] {
  if (text.length <= maxLen) return [text];
  const parts: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    if (current.length + line.length + 1 > maxLen) {
      parts.push(current);
      current = line;
    } else {
      current += (current ? "\n" : "") + line;
    }
  }
  if (current) parts.push(current);
  return parts;
}
