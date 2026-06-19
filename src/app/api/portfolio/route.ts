import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUsdBalance, prisma } from "@/lib/db";
import { withRemaining } from "@/lib/calculations";
import type { Buy, Sell } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.user.id);

  const [buyRows, sellRows, usd] = await Promise.all([
    prisma.buy.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    prisma.sell.findMany({ where: { userId }, orderBy: { id: "asc" } }),
    getUsdBalance(userId),
  ]);

  const buys: Buy[] = buyRows.map((b) => ({
    id: b.id,
    wallet: b.wallet,
    asset: b.asset,
    amount: b.amount,
    price: b.price,
    date: b.date,
  }));

  const sells: Sell[] = sellRows.map((s) => ({
    id: s.id,
    buyId: s.buyId,
    amount: s.amount,
    sellPrice: s.sellPrice,
    sellDate: s.sellDate,
    profit: s.profit,
  }));

  return NextResponse.json({
    buys: withRemaining(buys, sells),
    sells,
    usd,
  });
}
