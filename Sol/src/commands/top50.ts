import { Context } from "grammy";
import { handleTopHolders } from "./topholders";

export async function handleTop50(ctx: Context): Promise<void> {
  return handleTopHolders(ctx, 50);
}
