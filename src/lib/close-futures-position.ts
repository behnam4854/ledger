import Decimal from "decimal.js";
import { DEFAULT_FUTURES_USD, FUTURES_USD_KEY, prisma } from "./db";
import { completedFundingIntervals, futuresFee, futuresFunding, type FuturesSide } from "./futures";
import { recordFuturesActivity } from "./futures-activity";

export class FuturesCloseError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}

export async function closeFuturesPositionAtPrice(input: {
  userId: number;
  id: number;
  exitPrice: Decimal.Value;
  closeQuantity?: Decimal.Value;
  reason?: "MANUAL" | "STOP_LOSS" | "TAKE_PROFIT" | "LIQUIDATION";
}) {
  const exitPrice = new Decimal(input.exitPrice);
  return prisma.$transaction(async (tx) => {
    const position = await tx.futuresPosition.findFirst({
      where: { id: input.id, userId: input.userId, status: "OPEN" },
      include: { executions: true },
    });
    if (!position) throw new FuturesCloseError("Position is already closed");
    const currentQuantity = new Decimal(position.quantity);
    const closeQuantity = input.closeQuantity === undefined ? currentQuantity : new Decimal(input.closeQuantity);
    if (!closeQuantity.isFinite() || closeQuantity.lessThanOrEqualTo(0)) throw new FuturesCloseError("Close quantity must be greater than zero", 400);
    if (closeQuantity.greaterThan(currentQuantity)) throw new FuturesCloseError("Close quantity exceeds the open quantity", 400);
    const isFullClose = closeQuantity.equals(currentQuantity);
    const currentMargin = new Decimal(position.margin);
    const allocatedMargin = currentMargin.times(closeQuantity).div(currentQuantity);
    const remainingQuantity = currentQuantity.minus(closeQuantity);
    const remainingMargin = currentMargin.minus(allocatedMargin);
    const initialQuantity = new Decimal(position.initialQuantity ?? position.quantity);
    const initialMargin = new Decimal(position.initialMargin ?? position.margin);
    const closedAt = new Date();
    const exitFee = new Decimal(futuresFee(closeQuantity.times(exitPrice), position.feeRateBps ?? "0"));
    const intervals = completedFundingIntervals(position.openedAt, closedAt, position.fundingIntervalHours ?? 8);
    const fundingPnl = new Decimal(futuresFunding({
      notional: closeQuantity.times(position.entryPrice),
      ratePercent: position.fundingRate ?? "0",
      intervals,
      side: position.side as FuturesSide,
    }));
    const direction = position.side === "LONG" ? new Decimal(1) : new Decimal(-1);
    const grossPnl = exitPrice.minus(position.entryPrice).times(closeQuantity).times(direction);
    const entryFee = new Decimal(position.entryFee ?? "0").times(closeQuantity).div(initialQuantity);
    const closeCredit = Decimal.max(allocatedMargin.plus(grossPnl).minus(exitFee).plus(fundingPnl), 0);
    const realizedPnl = closeCredit.minus(allocatedMargin).minus(entryFee);
    const priorGross = Decimal.sum(0, ...position.executions.map((execution) => execution.grossPnl));
    const priorExitFees = Decimal.sum(0, ...position.executions.map((execution) => execution.exitFee));
    const priorFunding = Decimal.sum(0, ...position.executions.map((execution) => execution.fundingPnl));
    const priorRealized = Decimal.sum(0, ...position.executions.map((execution) => execution.realizedPnl));
    const priorClosedQuantity = Decimal.sum(0, ...position.executions.map((execution) => execution.quantity));
    const weightedExitValue = Decimal.sum(closeQuantity.times(exitPrice), ...position.executions.map((execution) => new Decimal(execution.quantity).times(execution.exitPrice)));
    const totalClosedQuantity = priorClosedQuantity.plus(closeQuantity);
    const setting = await tx.setting.findUnique({ where: { userId_key: { userId: input.userId, key: FUTURES_USD_KEY } } });
    const balance = new Decimal(setting?.value ?? DEFAULT_FUTURES_USD);
    await tx.setting.upsert({
      where: { userId_key: { userId: input.userId, key: FUTURES_USD_KEY } },
      create: { userId: input.userId, key: FUTURES_USD_KEY, value: balance.plus(closeCredit).toString() },
      update: { value: balance.plus(closeCredit).toString() },
    });
    await tx.futuresExecution.create({ data: {
      positionId: input.id,
      quantity: closeQuantity.toString(),
      exitPrice: exitPrice.toString(),
      allocatedMargin: allocatedMargin.toString(),
      entryFee: entryFee.toString(),
      exitFee: exitFee.toString(),
      fundingPnl: fundingPnl.toString(),
      grossPnl: grossPnl.toString(),
      realizedPnl: realizedPnl.toString(),
      reason: input.reason ?? "MANUAL",
      closedAt,
    } });
    await tx.futuresPosition.update({ where: { id: input.id }, data: {
      initialQuantity: initialQuantity.toString(),
      initialMargin: initialMargin.toString(),
      quantity: isFullClose ? initialQuantity.toString() : remainingQuantity.toString(),
      margin: isFullClose ? initialMargin.toString() : remainingMargin.toString(),
      status: isFullClose ? "CLOSED" : "OPEN",
      exitPrice: weightedExitValue.div(totalClosedQuantity).toString(),
      exitFee: priorExitFees.plus(exitFee).toString(),
      fundingPnl: priorFunding.plus(fundingPnl).toString(),
      grossPnl: priorGross.plus(grossPnl).toString(),
      realizedPnl: priorRealized.plus(realizedPnl).toString(),
      closeReason: isFullClose ? input.reason ?? "MANUAL" : null,
      closedAt: isFullClose ? closedAt : null,
    } });
    const reason = input.reason ?? "MANUAL";
    await recordFuturesActivity(tx, {
      userId: input.userId,
      positionId: input.id,
      asset: position.asset,
      side: position.side,
      action: isFullClose ? "POSITION_CLOSED" : "POSITION_PARTIALLY_CLOSED",
      summary: isFullClose
        ? `Closed ${position.asset} ${position.side} (${reason.replaceAll("_", " ").toLowerCase()})`
        : `Partially closed ${position.asset} ${position.side}`,
      details: {
        reason, closeQuantity: closeQuantity.toString(), exitPrice: exitPrice.toString(),
        grossPnl: grossPnl.toString(), realizedPnl: realizedPnl.toString(), exitFee: exitFee.toString(),
        fundingPnl: fundingPnl.toString(), remainingQuantity: isFullClose ? "0" : remainingQuantity.toString(),
        remainingMargin: isFullClose ? "0" : remainingMargin.toString(),
      },
    });
    return { pnl: realizedPnl.toString(), fullyClosed: isFullClose };
  });
}
