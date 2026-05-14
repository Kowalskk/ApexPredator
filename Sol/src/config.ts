import dotenv from "dotenv";
dotenv.config();

export const config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN!,
  heliusApiKey: process.env.HELIUS_API_KEY!,
  birdeyeApiKey: process.env.BIRDEYE_API_KEY,
  moralisApiKey: process.env.MORALIS_API_KEY,
  ankrApiKey: process.env.ANKR_API_KEY || "",
  arkhamApiKey: process.env.ARKHAM_API_KEY || "",

  // EVM RPC providers (for eth_getLogs / eth_getCode)
  alchemyEthKey: process.env.ALCHEMY_ETH_KEY || "",
  alchemyBscKey: process.env.ALCHEMY_BSC_KEY || "",
  alchemyBaseKey: process.env.ALCHEMY_BASE_KEY || "",
  drpcKey: process.env.DRPC_KEY || "",
  noderealKey: process.env.NODEREAL_KEY || "",
  chainstackEthUrl: process.env.CHAINSTACK_ETH_URL || "",
  blockpiEthUrl: process.env.BLOCKPI_ETH_URL || "",

  // Other APIs
  goplusPublicKey: process.env.GOPLUS_PUBLIC_KEY || "",
  goplusSecretKey: process.env.GOPLUS_SECRET_KEY || "",
  gmgnApiKey: process.env.GMGN_API_KEY || "",

  // Rate limiting
  heliusRpsGeneral: 10,
  heliusRpsDas: 2,

  // Cache TTL in ms
  cacheTtl: 5 * 60 * 1000, // 5 minutes

  // Thresholds
  minHoldingValueUsd: 5, // minimum USD value to show in portfolio
  maxContracts: 3, // max contracts for /kol command
};
