import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { getUsdBalance, setUsdBalance } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.user.id);
  return NextResponse.json({ usd: await getUsdBalance(userId) });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.user.id);

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

  const current = await getUsdBalance(userId);

  if (action === "add") {
    return NextResponse.json({ usd: await setUsdBalance(userId, current + amount) });
  }
  if (action === "withdraw") {
    if (amount > current) {
      return NextResponse.json({ error: `Insufficient funds. Available: $${current.toFixed(2)}` }, { status: 400 });
    }
    return NextResponse.json({ usd: await setUsdBalance(userId, current - amount) });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
