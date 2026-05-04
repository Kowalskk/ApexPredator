export function isValidEvmAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address);
}

export function isValidEvmTx(hash: string): boolean {
  return /^0x[0-9a-fA-F]{64}$/.test(hash);
}

export function detectChain(address: string): "solana" | "evm" | null {
  if (isValidEvmAddress(address)) return "evm";
  // Solana: base58, 32-44 chars
  if (/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) return "solana";
  return null;
}

export function shortenEvmAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

// HTML-safe escape for Telegram HTML parse_mode
export function escHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export const EVM_CHAINS: Record<string, { name: string; explorer: string; coingeckoId: string }> = {
  "1":     { name: "Ethereum", explorer: "https://etherscan.io",   coingeckoId: "ethereum" },
  "56":    { name: "BSC",      explorer: "https://bscscan.com",    coingeckoId: "binancecoin" },
  "8453":  { name: "Base",     explorer: "https://basescan.org",   coingeckoId: "ethereum" },
  "42161": { name: "Arbitrum", explorer: "https://arbiscan.io",    coingeckoId: "ethereum" },
};
