import { NextResponse, type NextRequest } from "next/server";
import { getUsdBalance, setUsdBalance } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ usd: await getUsdBalance() });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = String(body.action ?? "");
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "Amount must be > 0" }, { status: 400 });
  }

  const current = await getUsdBalance();

  if (action === "add") {
    return NextResponse.json({ usd: await setUsdBalance(current + amount) });
  }
  if (action === "withdraw") {
    if (amount > current) {
      return NextResponse.json({ error: `Insufficient funds. Available: $${current.toFixed(2)}` }, { status: 400 });
    }
    return NextResponse.json({ usd: await setUsdBalance(current - amount) });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
