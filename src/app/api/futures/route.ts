import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getFuturesBalance, prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.user.id);
  const [balance, rows] = await Promise.all([
    getFuturesBalance(userId),
    prisma.futuresPosition.findMany({ where: { userId }, orderBy: { openedAt: "desc" } }),
  ]);

  return NextResponse.json({
    balance,
    positions: rows.map((row) => ({
      id: row.id,
      asset: row.asset,
      side: row.side,
      leverage: row.leverage,
      margin: row.margin,
      quantity: row.quantity,
      entryPrice: row.entryPrice,
      stopLoss: row.stopLoss,
      takeProfit: row.takeProfit,
      status: row.status,
      exitPrice: row.exitPrice,
      realizedPnl: row.realizedPnl,
      openedAt: row.openedAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
    })),
  });
}
