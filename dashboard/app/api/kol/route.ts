import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const backendUrl = process.env.BACKEND_URL ?? "http://localhost:3001";

  try {
    const res = await fetch(`${backendUrl}/api/kol`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.API_SECRET ?? "apex2026"}`,
      },
      body: JSON.stringify(body),
      // KOL scan can take up to 3 min
      signal: AbortSignal.timeout(300_000),
    });

    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
