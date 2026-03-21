import { TokenHolding } from "../types";

// ─── Known Exchange / CEX Wallet Addresses on Solana ────────────────────────
// Extend this list as you discover more exchange addresses.
export const KNOWN_WALLETS: Record<string, { name: string; emoji: string }> = {
  // Binance
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM": { name: "Binance", emoji: "🏦" },
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvh2Bi": { name: "Binance", emoji: "🏦" },
  "AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2": { name: "Binance", emoji: "🏦" },
  "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqmWGHG8S": { name: "Binance", emoji: "🏦" },
  "4bfCiECFHFEfGADLzHjRVMwuFDFxCrLrC6XNzijCkNBa": { name: "Binance", emoji: "🏦" },

  // Coinbase
  "H8sMJSCQxfKiFTCfDR3DUMLPwcRbM61LGFJ8N4dK3WjS": { name: "Coinbase", emoji: "🏦" },
  "GJRs4FwHtemZ5ZE9x3FNvJ8TMwitKTh21yxdRPqn7npE": { name: "Coinbase", emoji: "🏦" },

  // Kraken
  "FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiouN5": { name: "Kraken", emoji: "🏦" },
  "BtWCbpvpPNrUkCFjGBQmJbqVEkfSAMzZb3pD9RTGN8M": { name: "Kraken", emoji: "🏦" },

  // Gate.io
  "HVh6wHNBAsG3pq1Bj5oCzRjoWKVogEDHwUHkRz3ekFgt": { name: "Gate.io", emoji: "🏦" },
  "BmFdpraQhkiDnChdc8GHZeFzogPLQNNUAtHW6jTi5Rk9": { name: "Gate.io", emoji: "🏦" },

  // OKX
  "5VCwKtCXgCJ6kit5FybXjvriW3xELsFDhYrPSqtJNmcD": { name: "OKX", emoji: "🏦" },
  "2BJKMVkYCiZjmcNpVpGpBxBQRFwTVkzVTTCBoTBwsKjZ": { name: "OKX", emoji: "🏦" },

  // Bybit
  "GE4zqXcryvMHGcAB3RvC7FU3dEGFEBEBbVQnHgSLPxKP": { name: "Bybit", emoji: "🏦" },

  // MEXC
  "MExSMVGsM5aNXuipSGNqKQNGnqRy1Bq2KNa1amdBjEH": { name: "MEXC", emoji: "🏦" },
  "GGUFcyBBzMFVGrJaAnJaJ5WN3nHNhFQfpW7KRDKXT5VD": { name: "MEXC", emoji: "🏦" },

  // Bitget
  "HiDFHqxoXJRoHxvP9fxBJFHCJZgUoMjJcTGDPiNp5YFU": { name: "Bitget", emoji: "🏦" },

  // Bitvavo
  "22tEFBgHsFLe9FGqg2JTaCCYfUqfH7QhVJtLnGHH7kEm": { name: "Bitvavo", emoji: "🏦" },

  // Kucoin
  "FNYCaCLEb7GXTmgBuoRuHnwWGZwP8M5nrG6WrXCZdHfS": { name: "Kucoin", emoji: "🏦" },

  // HTX (Huobi)
  "DuFMM6CjTJnCfzwwdJnKmCMVGGumT3RHiEDFBX89Kz9": { name: "HTX", emoji: "🏦" },

  // Indodax
  "8yUCBBHfz7TZgcxNdJWm6gFz6M6xmpLU8b2FPxAjSwCZ": { name: "Indodax", emoji: "🏦" },

  // Known LP/Pool programs (labeled as pools, not exchanges)
  "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1": { name: "Raydium LP", emoji: "🏊" },
  "GThUX1Atko4tqhN2NaiTazWSeFWMuiUvfFnyJyUghFMJ": { name: "Raydium LP", emoji: "🏊" },
};

// ─── Stable / Blue-chip token symbols ───────────────────────────────────────
const STABLES = new Set(["USDC", "USDT", "DAI", "BUSD", "USDH", "USDD"]);
const BLUECHIPS = new Set(["WBTC", "WETH", "wSOL", "ETH", "BTC", "SOL"]);

// ─── Wallet Classification ───────────────────────────────────────────────────

export interface WalletClassification {
  /** Display name — exchange name if known, otherwise null */
  exchangeName: string | null;
  /** Emoji string to show after address */
  emojis: string;
  /** Is this a known exchange/CEX? */
  isExchange: boolean;
}

export function classifyWallet(opts: {
  address: string;
  holdingPct: number;        // % of the analyzed token's supply
  totalPortfolioUsd: number;
  holdings: TokenHolding[];
  isFresh: boolean;
}): WalletClassification {
  const { address, holdingPct, totalPortfolioUsd, holdings, isFresh } = opts;

  // 1. Check known wallets first
  const known = KNOWN_WALLETS[address];
  if (known) {
    return { exchangeName: known.name, emojis: known.emoji, isExchange: true };
  }

  const emojiParts: string[] = [];

  // 2. Size emoji (based on % of supply held)
  if (holdingPct >= 5) {
    emojiParts.push("🐋"); // mega whale
  } else if (holdingPct >= 2) {
    emojiParts.push("🐋"); // whale
  } else if (holdingPct >= 1) {
    emojiParts.push("🦈"); // big fish
  } else if (holdingPct >= 0.3) {
    emojiParts.push("🐟"); // fish
  } else {
    emojiParts.push("🐠"); // small fish
  }

  // 3. Portfolio quality
  const stableValue = holdings
    .filter((h) => STABLES.has(h.symbol))
    .reduce((s, h) => s + h.usdValue, 0);

  const blueChipValue = holdings
    .filter((h) => BLUECHIPS.has(h.symbol))
    .reduce((s, h) => s + h.usdValue, 0);

  const stableAndBlueChip = stableValue + blueChipValue;

  if (totalPortfolioUsd >= 100_000) {
    emojiParts.push("🦅"); // large smart money
  } else if (stableAndBlueChip >= totalPortfolioUsd * 0.4 && totalPortfolioUsd >= 5_000) {
    emojiParts.push("💎"); // diamond hands (mainly stables/blue chips)
  } else if (holdings.length >= 8) {
    emojiParts.push("🔥"); // degen, many tokens
  }

  // 4. Fresh wallet
  if (isFresh) {
    emojiParts.push("🌱");
  }

  return {
    exchangeName: null,
    emojis: emojiParts.join(" "),
    isExchange: false,
  };
}
