export interface TokenHolder {
  owner: string;
  amount: number;
  decimals: number;
}

export interface TokenHolding {
  mint: string;
  symbol: string;
  name: string;
  amount: number;       // human-readable (divided by decimals)
  rawBalance: number;   // raw on-chain balance (for % of supply calc)
  decimals: number;
  usdValue: number;
  totalSupply?: number; // raw total supply from token_info.supply
}

export interface WalletPortfolio {
  address: string;
  holdings: TokenHolding[];
  totalValueUsd: number;
}

export interface TokenPrice {
  mint: string;
  priceUsd: number;
}

export interface KolResult {
  contracts: string[];
  commonWallets: string[];
  totalFound: number;
}

export interface TopHoldersResult {
  tokenMint: string;
  tokenSymbol: string;
  holders: {
    rank: number;
    address: string;
    amount: number;
    percentage: number;
    portfolio: TokenHolding[];
  }[];
}

// ─── Swap / Wallet History ───────────────────────────────────────────────────

export interface SwapTransaction {
  mint: string;
  symbol: string;
  bought: number;
  sold: number;
  timestamp: number;
}

// ─── pump.fun ────────────────────────────────────────────────────────────────

export interface GraduatedToken {
  mint: string;
  name: string;
  symbol: string;
  usdMarketCap: number;
  createdTimestamp: number;
}

export interface EarlyBuyer {
  wallet: string;
  solAmount: number;
  tokenAmount: number;
  timestamp: number;
}

// ─── Bundle Detection ────────────────────────────────────────────────────────

export interface BundleResult {
  isBundled: boolean;
  bundledWallets: string[];
  bundleSlot: number;
  totalBundled: number;
}

// ─── Wallet Age / Funding ────────────────────────────────────────────────────

export interface WalletAgeInfo {
  address: string;
  firstTxTimestamp: number;
  txCount: number;
  isFresh: boolean;
}

export interface FunderInfo {
  funder: string | null;
  amount: number;
  timestamp: number;
}

// ─── CoinGecko Heatmap ───────────────────────────────────────────────────────

export interface HeatmapCoin {
  id: string;
  symbol: string;
  name: string;
  currentPrice: number;
  priceChangePercentage24h: number;
  marketCap: number;
}
