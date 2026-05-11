import dotenv from "dotenv";
dotenv.config();

export const config = {
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN!,
  heliusApiKey: process.env.HELIUS_API_KEY!,
  birdeyeApiKey: process.env.BIRDEYE_API_KEY,
  moralisApiKey: process.env.MORALIS_API_KEY,
  ankrApiKey: process.env.ANKR_API_KEY || "",
  arkhamApiKey: process.env.ARKHAM_API_KEY || "",

  // Rate limiting
  heliusRpsGeneral: 10,
  heliusRpsDas: 2,

  // Cache TTL in ms
  cacheTtl: 5 * 60 * 1000, // 5 minutes

  // Thresholds
  minHoldingValueUsd: 5, // minimum USD value to show in portfolio
  maxContracts: 3, // max contracts for /kol command
};
