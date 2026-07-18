import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { closeFuturesPositionAtPrice, FuturesCloseError } from "@/lib/close-futures-position";
import { getUserCoins, prisma } from "@/lib/db";
import { completedFundingIntervals, futuresFunding, futuresMetrics, type FuturesSide } from "@/lib/futures";
import { getFuturesMarket } from "@/lib/futures-market";
import { getPrices } from "@/lib/prices";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.user.id);
  const positions = await prisma.futuresPosition.findMany({ where: { userId, status: "OPEN", autoCloseEnabled: true } });
  if (!positions.length) return NextResponse.json({ executed: [] });
  const coins = await getUserCoins(userId);
  const { prices } = await getPrices(coins);
  const market = await getFuturesMarket(coins, prices);
  const executed: { id: number; reason: string; price: string }[] = [];
  for (const position of positions) {
    const mark = market.quotes[position.asset]?.markPrice || prices[position.asset];
    if (!(mark > 0)) continue;
    const intervals = completedFundingIntervals(position.openedAt, Date.now(), position.fundingIntervalHours ?? 8);
    const fundingPnl = futuresFunding({
      notional: Number(position.quantity) * Number(position.entryPrice),
      ratePercent: position.fundingRate ?? "0",
      intervals,
      side: position.side as FuturesSide,
    });
    const metrics = futuresMetrics({
      side: position.side as FuturesSide,
      entryPrice: position.entryPrice,
      markPrice: mark,
      margin: position.margin,
      leverage: position.leverage,
      quantity: position.quantity,
      maintenanceMarginRatePercent: position.maintenanceMarginRate ?? "0.5",
      exitFeeRateBps: position.feeRateBps ?? "0",
      fundingPnl,
    });
    const stopHit = position.stopLoss && (position.side === "LONG" ? mark <= Number(position.stopLoss) : mark >= Number(position.stopLoss));
    const takeHit = position.takeProfit && (position.side === "LONG" ? mark >= Number(position.takeProfit) : mark <= Number(position.takeProfit));
    const reason = metrics.liquidated ? "LIQUIDATION" : stopHit ? "STOP_LOSS" : takeHit ? "TAKE_PROFIT" : null;
    if (!reason) continue;
    const exitPrice = reason === "LIQUIDATION"
      ? metrics.liquidationPrice
      : reason === "STOP_LOSS" ? position.stopLoss! : position.takeProfit!;
    try {
      await closeFuturesPositionAtPrice({ userId, id: position.id, exitPrice, reason });
      executed.push({ id: position.id, reason, price: exitPrice });
    } catch (error) {
      if (!(error instanceof FuturesCloseError)) throw error;
    }
  }
  return NextResponse.json({ executed });
}
