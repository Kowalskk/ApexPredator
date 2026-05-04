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

// ─── GMGN-style Wallet Tags ─────────────────────────────────────────────────
// Based on GMGN taxonomy: sniper, bundler, rat_trader, fresh_wallet, smart_degen
// Each tag is derived from on-chain signals we can compute.

export type WalletTag =
  | "sniper"        // bought in first seconds of launch
  | "bundler"       // part of a multi-wallet atomic buy at deploy
  | "fresh_wallet"  // newly created, <20 txs or <30 days
  | "smart_degen"   // holds 8+ tokens, large portfolio
  | "diamond"       // >40% in stables/blue-chips
  | "whale"         // holds >2% of token supply
  | "shark"         // holds >1% of token supply
  | "fish"          // holds >0.3% of token supply
  | "cex";          // known CEX deposit address

export const TAG_EMOJI: Record<WalletTag, string> = {
  sniper: "🎯",
  bundler: "📦",
  fresh_wallet: "🌱",
  smart_degen: "🔥",
  diamond: "💎",
  whale: "🐋",
  shark: "🦈",
  fish: "🐟",
  cex: "🏦",
};

// ─── Wallet Classification ───────────────────────────────────────────────────

export interface WalletClassification {
  /** Display name — exchange name if known, otherwise null */
  exchangeName: string | null;
  /** Emoji string to show after address */
  emojis: string;
  /** Is this a known exchange/CEX? */
  isExchange: boolean;
  /** GMGN-style structured tags */
  tags: WalletTag[];
}

export function classifyWallet(opts: {
  address: string;
  holdingPct: number;
  totalPortfolioUsd: number;
  holdings: TokenHolding[];
  isFresh: boolean;
}): WalletClassification {
  const { address, holdingPct, totalPortfolioUsd, holdings, isFresh } = opts;

  // 1. Known CEX / exchange wallets
  const known = KNOWN_WALLETS[address];
  if (known) {
    return {
      exchangeName: known.name,
      emojis: known.emoji,
      isExchange: true,
      tags: ["cex"],
    };
  }

  const tags: WalletTag[] = [];

  // 2. Size tag by % of supply held (GMGN-inspired thresholds)
  if (holdingPct >= 2) tags.push("whale");
  else if (holdingPct >= 1) tags.push("shark");
  else if (holdingPct >= 0.3) tags.push("fish");

  // 3. Portfolio quality
  const stableValue = holdings
    .filter((h) => STABLES.has(h.symbol))
    .reduce((s, h) => s + h.usdValue, 0);
  const blueChipValue = holdings
    .filter((h) => BLUECHIPS.has(h.symbol))
    .reduce((s, h) => s + h.usdValue, 0);
  const stableAndBlueChip = stableValue + blueChipValue;

  if (stableAndBlueChip >= totalPortfolioUsd * 0.4 && totalPortfolioUsd >= 5_000) {
    tags.push("diamond");
  } else if (holdings.length >= 8) {
    tags.push("smart_degen");
  }

  // 4. Fresh wallet
  if (isFresh) tags.push("fresh_wallet");

  const emojis = tags.map((t) => TAG_EMOJI[t]).join(" ");

  return {
    exchangeName: null,
    emojis,
    isExchange: false,
    tags,
  };
}
