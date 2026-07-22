import Decimal from "decimal.js";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { DEFAULT_FUTURES_USD, FUTURES_USD_KEY, prisma } from "@/lib/db";
import { completedFundingIntervals, futuresFee, futuresFunding, type FuturesSide } from "@/lib/futures";
import { recordFuturesActivity } from "@/lib/futures-activity";

function decimal(value: unknown, label: string, options?: { allowZero?: boolean }) {
  try {
    const parsed = new Decimal(String(value ?? ""));
    if (!parsed.isFinite() || (options?.allowZero ? parsed.isNegative() : parsed.lessThanOrEqualTo(0))) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label} must be ${options?.allowZero ? "zero or greater" : "greater than zero"}`);
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.user.id);
  const id = Number((await params).id);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  try {
    const side = String(body.side ?? "").toUpperCase() as FuturesSide;
    if (side !== "LONG" && side !== "SHORT") throw new Error("Choose LONG or SHORT");
    const leverage = Number(body.leverage);
    if (!Number.isInteger(leverage) || leverage < 1 || leverage > 20) throw new Error("Leverage must be between 1x and 20x");
    const margin = decimal(body.margin, "Margin");
    const entryPrice = decimal(body.entryPrice, "Entry price");
    const exitPrice = decimal(body.exitPrice, "Exit price");
    const feeRateBps = decimal(body.feeRateBps ?? "0", "Fee rate", { allowZero: true });
    const fundingRate = new Decimal(String(body.fundingRate ?? "0"));
    if (!fundingRate.isFinite() || fundingRate.abs().greaterThan(10)) throw new Error("Funding rate must be between -10% and 10%");
    const optionalPrice = (value: unknown) => String(value ?? "").trim() ? decimal(value, "SL/TP") : null;
    const stopLoss = optionalPrice(body.stopLoss);
    const takeProfit = optionalPrice(body.takeProfit);
    if (side === "LONG" && stopLoss && stopLoss.greaterThanOrEqualTo(entryPrice)) throw new Error("LONG stop-loss must be below entry");
    if (side === "LONG" && takeProfit && takeProfit.lessThanOrEqualTo(entryPrice)) throw new Error("LONG take-profit must be above entry");
    if (side === "SHORT" && stopLoss && stopLoss.lessThanOrEqualTo(entryPrice)) throw new Error("SHORT stop-loss must be above entry");
    if (side === "SHORT" && takeProfit && takeProfit.greaterThanOrEqualTo(entryPrice)) throw new Error("SHORT take-profit must be below entry");
    const openedAt = new Date(String(body.openedAt ?? ""));
    const closedAt = new Date(String(body.closedAt ?? ""));
    if (!Number.isFinite(openedAt.getTime()) || !Number.isFinite(closedAt.getTime()) || closedAt <= openedAt) throw new Error("Closed time must be after opened time");

    const result = await prisma.$transaction(async (tx) => {
      const position = await tx.futuresPosition.findFirst({ where: { id, userId, status: "CLOSED" }, include: { executions: { orderBy: { closedAt: "asc" } } } });
      if (!position) return { error: "Closed trade not found" } as const;
      const quantity = margin.times(leverage).div(entryPrice);
      const entryNotional = quantity.times(entryPrice);
      const entryFee = new Decimal(futuresFee(entryNotional, feeRateBps));
      const oldQuantity = new Decimal(position.initialQuantity ?? position.quantity);
      const oldOpened = position.openedAt.getTime();
      const oldClosed = position.closedAt?.getTime() ?? oldOpened;
      const sourceExecutions = position.executions.length ? position.executions : [{
        quantity: oldQuantity.toString(), closedAt: position.closedAt ?? closedAt, reason: position.closeReason ?? "MANUAL",
      }];
      const direction = side === "LONG" ? new Decimal(1) : new Decimal(-1);
      const rebuilt = sourceExecutions.map((execution, index) => {
        const share = new Decimal(execution.quantity).div(oldQuantity);
        const executionQuantity = quantity.times(share);
        const ratio = oldClosed > oldOpened ? Math.max(0, Math.min(1, (execution.closedAt.getTime() - oldOpened) / (oldClosed - oldOpened))) : 1;
        const executionClosedAt = index === sourceExecutions.length - 1 ? closedAt : new Date(openedAt.getTime() + ratio * (closedAt.getTime() - openedAt.getTime()));
        const allocatedMargin = margin.times(share);
        const allocatedEntryFee = entryFee.times(share);
        const exitFee = new Decimal(futuresFee(executionQuantity.times(exitPrice), feeRateBps));
        const intervals = completedFundingIntervals(openedAt, executionClosedAt, position.fundingIntervalHours ?? 8);
        const fundingPnl = new Decimal(futuresFunding({ notional: executionQuantity.times(entryPrice), ratePercent: fundingRate, intervals, side }));
        const grossPnl = exitPrice.minus(entryPrice).times(executionQuantity).times(direction);
        const closeCredit = Decimal.max(allocatedMargin.plus(grossPnl).minus(exitFee).plus(fundingPnl), 0);
        const realizedPnl = closeCredit.minus(allocatedMargin).minus(allocatedEntryFee);
        return { quantity: executionQuantity, allocatedMargin, entryFee: allocatedEntryFee, exitFee, fundingPnl, grossPnl, realizedPnl, closedAt: executionClosedAt, reason: execution.reason };
      });
      const grossPnl = Decimal.sum(0, ...rebuilt.map((execution) => execution.grossPnl));
      const exitFee = Decimal.sum(0, ...rebuilt.map((execution) => execution.exitFee));
      const fundingPnl = Decimal.sum(0, ...rebuilt.map((execution) => execution.fundingPnl));
      const realizedPnl = Decimal.sum(0, ...rebuilt.map((execution) => execution.realizedPnl));
      const oldRealizedPnl = new Decimal(position.realizedPnl ?? "0");
      const setting = await tx.setting.findUnique({ where: { userId_key: { userId, key: FUTURES_USD_KEY } } });
      const balance = new Decimal(setting?.value ?? DEFAULT_FUTURES_USD);
      const updatedBalance = balance.plus(realizedPnl).minus(oldRealizedPnl);
      if (updatedBalance.isNegative()) return { error: "Editing this trade would make the available balance negative" } as const;
      await tx.setting.upsert({ where: { userId_key: { userId, key: FUTURES_USD_KEY } }, create: { userId, key: FUTURES_USD_KEY, value: updatedBalance.toString() }, update: { value: updatedBalance.toString() } });
      await tx.futuresExecution.deleteMany({ where: { positionId: id } });
      await tx.futuresExecution.createMany({ data: rebuilt.map((execution) => ({
        positionId: id, quantity: execution.quantity.toString(), exitPrice: exitPrice.toString(), allocatedMargin: execution.allocatedMargin.toString(), entryFee: execution.entryFee.toString(), exitFee: execution.exitFee.toString(), fundingPnl: execution.fundingPnl.toString(), grossPnl: execution.grossPnl.toString(), realizedPnl: execution.realizedPnl.toString(), closedAt: execution.closedAt, reason: execution.reason,
      })) });
      await tx.futuresPosition.update({ where: { id }, data: {
        side, leverage, margin: margin.toString(), initialMargin: margin.toString(), quantity: quantity.toString(), initialQuantity: quantity.toString(), entryPrice: entryPrice.toString(), exitPrice: exitPrice.toString(), stopLoss: stopLoss?.toString() ?? null, takeProfit: takeProfit?.toString() ?? null, plannedRisk: stopLoss ? quantity.times(entryPrice.minus(stopLoss).abs()).toString() : null, feeRateBps: feeRateBps.toString(), entryFee: entryFee.toString(), exitFee: exitFee.toString(), fundingRate: fundingRate.toString(), fundingPnl: fundingPnl.toString(), grossPnl: grossPnl.toString(), realizedPnl: realizedPnl.toString(), openedAt, closedAt,
      } });
      await recordFuturesActivity(tx, {
        userId, positionId: id, asset: position.asset, side,
        action: "CLOSED_TRADE_EDITED",
        summary: `Edited closed ${position.asset} ${side} trade`,
        details: {
          previousSide: position.side, side, previousLeverage: position.leverage, leverage,
          previousMargin: position.initialMargin ?? position.margin, margin: margin.toString(),
          previousEntryPrice: position.entryPrice, entryPrice: entryPrice.toString(),
          previousExitPrice: position.exitPrice, exitPrice: exitPrice.toString(),
          previousRealizedPnl: position.realizedPnl, realizedPnl: realizedPnl.toString(),
        },
      });
      return { realizedPnl: realizedPnl.toString() } as const;
    });
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid closed trade" }, { status: 400 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.user.id);
  const id = Number((await params).id);
  const result = await prisma.$transaction(async (tx) => {
    const position = await tx.futuresPosition.findFirst({ where: { id, userId, status: "CLOSED" } });
    if (!position) return { error: "Closed trade not found" } as const;
    const setting = await tx.setting.findUnique({ where: { userId_key: { userId, key: FUTURES_USD_KEY } } });
    const balance = new Decimal(setting?.value ?? DEFAULT_FUTURES_USD);
    const updatedBalance = balance.minus(position.realizedPnl ?? "0");
    if (updatedBalance.isNegative()) return { error: "Deleting this winning trade would make the available balance negative" } as const;
    await tx.setting.upsert({ where: { userId_key: { userId, key: FUTURES_USD_KEY } }, create: { userId, key: FUTURES_USD_KEY, value: updatedBalance.toString() }, update: { value: updatedBalance.toString() } });
    await recordFuturesActivity(tx, {
      userId, positionId: id, asset: position.asset, side: position.side,
      action: "CLOSED_TRADE_DELETED",
      summary: `Deleted closed ${position.asset} ${position.side} trade`,
      details: {
        entryPrice: position.entryPrice, exitPrice: position.exitPrice,
        realizedPnl: position.realizedPnl, openedAt: position.openedAt.toISOString(),
        closedAt: position.closedAt?.toISOString() ?? null,
      },
    });
    await tx.futuresPosition.delete({ where: { id } });
    return { ok: true } as const;
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ ok: true });
}
