import { createBot } from "./bot";
import { config } from "./config";

async function checkHeliusKey(): Promise<void> {
  try {
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${config.heliusApiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSlot", params: [] }),
    });
    const json = (await res.json()) as any;
    if (json.error) {
      console.error(`⚠️  Helius API key inválida o sin créditos: ${json.error.message}`);
    } else {
      console.log(`✅ Helius OK — slot ${json.result}`);
    }
  } catch (err) {
    console.error("⚠️  No se pudo contactar Helius:", err);
  }
}

async function main() {
  console.log("🐺 ApexPredator_sol starting...");
  await checkHeliusKey();

  const bot = createBot();

  // Graceful shutdown
  const stop = () => {
    console.log("Shutting down...");
    bot.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  await bot.start({
    onStart: () => console.log("🐺 ApexPredator_sol is running!"),
  });
}

main().catch(console.error);
