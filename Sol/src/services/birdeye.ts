// Placeholder for future Birdeye API integration
// Will be used when USD portfolio values from Birdeye are needed

import { config } from "../config";

export async function getBirdeyeTokenPrice(_mint: string): Promise<number> {
  // TODO: Implement when Birdeye API key is available
  throw new Error("Birdeye integration not yet configured");
}
