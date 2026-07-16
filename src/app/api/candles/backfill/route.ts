import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { backfillAll } from "@/lib/marketdata";

export const dynamic = "force-dynamic";

// Pull historical daily closes from CoinGecko into the Candle table.
// Auth-protected: it makes outbound calls and writes shared market data.
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let days = 365;
  try {
    const body = (await req.json()) as { days?: unknown };
    if (typeof body.days === "number" && body.days > 0) {
      days = Math.min(Math.floor(body.days), 3650); // cap at ~10y
    }
  } catch {
    // empty/invalid body → use default
  }

  const results = await backfillAll(days);
  const total = results.reduce((n, r) => n + r.upserted, 0);
  return NextResponse.json({ results, total });
}
