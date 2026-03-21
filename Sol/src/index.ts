import { createBot } from "./bot";

async function main() {
  console.log("🐺 ApexPredator_sol starting...");

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
