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
    prisma.futuresPosition.findMany({
      where: { userId },
      orderBy: { openedAt: "desc" },
      include: { executions: { orderBy: { closedAt: "asc" } } },
    }),
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
      initialQuantity: row.initialQuantity,
      initialMargin: row.initialMargin,
      entryPrice: row.entryPrice,
      stopLoss: row.stopLoss,
      takeProfit: row.takeProfit,
      riskPercent: row.riskPercent,
      plannedRisk: row.plannedRisk,
      feeRateBps: row.feeRateBps,
      entryFee: row.entryFee,
      exitFee: row.exitFee,
      fundingRate: row.fundingRate,
      fundingIntervalHours: row.fundingIntervalHours,
      fundingPnl: row.fundingPnl,
      grossPnl: row.grossPnl,
      maintenanceMarginRate: row.maintenanceMarginRate,
      journalSetup: row.journalSetup,
      journalTags: row.journalTags,
      journalNotes: row.journalNotes,
      journalScreenshot: row.journalScreenshot,
      autoCloseEnabled: row.autoCloseEnabled,
      closeReason: row.closeReason,
      status: row.status,
      exitPrice: row.exitPrice,
      realizedPnl: row.realizedPnl,
      openedAt: row.openedAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
      executions: row.executions.map((execution) => ({
        id: execution.id,
        quantity: execution.quantity,
        exitPrice: execution.exitPrice,
        allocatedMargin: execution.allocatedMargin,
        entryFee: execution.entryFee,
        exitFee: execution.exitFee,
        fundingPnl: execution.fundingPnl,
        grossPnl: execution.grossPnl,
        realizedPnl: execution.realizedPnl,
        reason: execution.reason,
        closedAt: execution.closedAt.toISOString(),
      })),
    })),
  });
}
