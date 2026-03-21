import { Context, InputFile } from "grammy";
import { getTopCoinsHeatmap } from "../services/coingecko";
import { HeatmapCoin } from "../types";

function getColor(pct: number): string {
  if (pct > 10) return "#007a33";
  if (pct > 5) return "#00a846";
  if (pct > 2) return "#2ecc71";
  if (pct > 0) return "#85e0a3";
  if (pct > -2) return "#e07b7b";
  if (pct > -5) return "#e74c3c";
  if (pct > -10) return "#c0392b";
  return "#7f0000";
}

function formatPct(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

function formatPrice(price: number): string {
  if (price >= 10000) return `$${(price / 1000).toFixed(0)}K`;
  if (price >= 1) return `$${price.toFixed(2)}`;
  if (price >= 0.01) return `$${price.toFixed(4)}`;
  return `$${price.toExponential(2)}`;
}

async function generateHeatmapImage(coins: HeatmapCoin[]): Promise<Buffer> {
  // Sort by 24h change descending for visual grouping
  const sorted = [...coins].sort(
    (a, b) => b.priceChangePercentage24h - a.priceChangePercentage24h
  );

  const labels = sorted.map((c) => c.symbol.toUpperCase());
  const data = sorted.map((c) => Math.abs(c.priceChangePercentage24h));
  const colors = sorted.map((c) => getColor(c.priceChangePercentage24h));
  const pctLabels = sorted.map((c) => formatPct(c.priceChangePercentage24h));
  const priceLabels = sorted.map((c) => formatPrice(c.currentPrice));

  // Build quickchart config — horizontal bar chart styled as heatmap
  const chartConfig = {
    type: "horizontalBar",
    data: {
      labels,
      datasets: [
        {
          data,
          backgroundColor: colors,
          borderColor: colors,
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: false,
      legend: { display: false },
      title: {
        display: true,
        text: "🌡️ Market Heatmap (24h)",
        fontColor: "#ffffff",
        fontSize: 18,
        fontStyle: "bold",
      },
      plugins: {
        datalabels: {
          display: true,
          color: "#ffffff",
          font: { weight: "bold", size: 11 },
          formatter: (_val: number, ctx: any) => {
            const i = ctx.dataIndex;
            return `${labels[i]}  ${pctLabels[i]}  ${priceLabels[i]}`;
          },
          anchor: "start",
          align: "right",
        },
      },
      scales: {
        xAxes: [
          {
            display: false,
            ticks: { beginAtZero: true },
            gridLines: { display: false },
          },
        ],
        yAxes: [
          {
            ticks: {
              fontColor: "#ffffff",
              fontSize: 12,
            },
            gridLines: { color: "rgba(255,255,255,0.1)" },
          },
        ],
      },
      layout: {
        padding: { left: 10, right: 20, top: 10, bottom: 10 },
      },
    },
  };

  const body = {
    width: 700,
    height: Math.max(400, sorted.length * 22 + 80),
    backgroundColor: "#1a1a2e",
    format: "png",
    chart: chartConfig,
  };

  const res = await fetch("https://quickchart.io/chart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`quickchart.io error: ${res.status}`);
  }

  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

export async function handleHmap(ctx: Context): Promise<void> {
  const statusMsg = await ctx.reply("🌡️ Generating market heatmap...");

  try {
    const coins: HeatmapCoin[] = await getTopCoinsHeatmap(30);

    if (coins.length === 0) {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        "❌ Failed to fetch market data. Please try again later."
      );
      return;
    }

    const imageBuffer = await generateHeatmapImage(coins);

    // Delete the status message and send the image
    await ctx.api.deleteMessage(ctx.chat!.id, statusMsg.message_id);
    await ctx.replyWithPhoto(new InputFile(imageBuffer, "heatmap.png"), {
      caption: "🌡️ *Market Heatmap (24h)*",
      parse_mode: "MarkdownV2",
    });
  } catch (err) {
    console.error("Hmap command error:", err);
    // Fallback to text if image generation fails
    try {
      const coins = await getTopCoinsHeatmap(20);
      const sorted = [...coins].sort(
        (a, b) => b.priceChangePercentage24h - a.priceChangePercentage24h
      );
      let text = "🌡️ *Market Heatmap \\(24h\\)*\n\n";
      for (const c of sorted) {
        const pct = c.priceChangePercentage24h;
        const emoji = pct > 5 ? "🟢" : pct > 0 ? "🟡" : pct > -5 ? "🟠" : "🔴";
        const sign = pct >= 0 ? "\\+" : "";
        text += `${emoji} *${c.symbol.toUpperCase()}* \\— ${sign}${pct.toFixed(2)}%\n`;
      }
      await ctx.api.editMessageText(ctx.chat!.id, statusMsg.message_id, text, {
        parse_mode: "MarkdownV2",
      });
    } catch {
      await ctx.api.editMessageText(
        ctx.chat!.id,
        statusMsg.message_id,
        "❌ Error generating heatmap. Please try again later."
      );
    }
  }
}
