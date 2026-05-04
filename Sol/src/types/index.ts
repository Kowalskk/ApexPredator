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

export interface TokenTrade {
  mint: string;
  symbol: string;
  solIn: number;       // SOL spent buying
  solOut: number;      // SOL received selling
  pnlSol: number;      // solOut - solIn
  pnlUsd: number;      // pnlSol * solPrice
  pnlRatio: number;    // pnl / cost (GMGN-style, 2.0 = doubled)
  isOpen: boolean;     // sold < bought (still holding)
  firstBuyTs: number;
  lastSellTs: number;
  holdingSeconds: number;  // lastSellTs - firstBuyTs (if closed)
  lastTimestamp: number;
}

export interface LpActivity {
  mint: string;
  symbol: string;
  solDeposited: number;
  solWithdrawn: number;
  pnlSol: number;
  pnlUsd: number;
}

export interface OutgoingTransfer {
  mint: string;
  symbol: string;
  amount: number;
  toAddress: string;
  timestamp: number;
}

export type TradeStyle = "scalper" | "day" | "swing" | "holder" | "mixed";

export interface WalletPnlResult {
  address: string;
  totalTrades: number;
  wins: number;
  losses: number;
  openPositions: number;
  winrate: number;
  pnlRatio: number;        // GMGN: total_profit / total_cost
  swapPnlSol: number;
  swapPnlUsd: number;
  lpPnlSol: number;
  lpPnlUsd: number;
  totalPnlUsd: number;
  totalCostUsd: number;
  solPriceUsd: number;
  tradingStyle: TradeStyle;
  medianHoldingSeconds: number;
  trades: TokenTrade[];
  lpActivities: LpActivity[];
  outgoingTransfers: OutgoingTransfer[];
  txCount: number;
}

// ─── EVM Wallet PnL ──────────────────────────────────────────────────────────

export interface EvmTokenTrade {
  tokenAddress: string;
  symbol: string;
  ethIn: number;       // ETH/BNB spent buying
  ethOut: number;      // ETH/BNB received selling
  usdIn: number;
  usdOut: number;
  pnlUsd: number;
  pnlRatio: number;    // pnl / cost
  isOpen: boolean;
  firstBuyTs: number;
  lastTs: number;
  holdingSeconds: number;
}

export interface EvmWalletPnlResult {
  address: string;
  chain: string;
  totalTrades: number;
  wins: number;
  losses: number;
  openPositions: number;
  winrate: number;
  pnlRatio: number;
  totalPnlUsd: number;
  totalCostUsd: number;
  nativePriceUsd: number;   // ETH or BNB price
  tradingStyle: TradeStyle;
  medianHoldingSeconds: number;
  trades: EvmTokenTrade[];
  outgoingTransfers: OutgoingTransfer[];
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

// ─── Sniper Cabal Analysis ──────────────────────────────────────────────────

export interface SniperWallet {
  address: string;
  tokensSniped: { mint: string; symbol: string; solBought: number; timestamp: number }[];
  funder: string | null;
  funderLabel: string | null;
  fundingAmount: number;       // SOL received from funder
  fundingTimestamp: number;    // when funder sent SOL
  gapSecondsBeforeFirstBuy: number;  // seconds between funding and first buy
}

export interface SniperCluster {
  id: string;                  // A, B, C...
  reason: string;              // why these were grouped
  sharedFunder: string | null;
  sharedAmount: number | null; // if amounts match
  wallets: SniperWallet[];
}

export interface SniperAnalysisResult {
  tokens: { mint: string; symbol: string }[];
  totalSnipers: number;
  clusters: SniperCluster[];
  orphans: SniperWallet[];
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
