import Decimal from "decimal.js";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { DEFAULT_FUTURES_USD, FUTURES_USD_KEY, getUserCoins, prisma } from "@/lib/db";
import { futuresMetrics, type FuturesSide } from "@/lib/futures";
import { getFuturesMarket } from "@/lib/futures-market";
import { getPrices } from "@/lib/prices";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.user.id);
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid position id" }, { status: 400 });
  const current = await prisma.futuresPosition.findFirst({ where: { id, userId, status: "OPEN" } });
  if (!current) return NextResponse.json({ error: "Open position not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const optionalPrice = (value: unknown, label: string): { value: Decimal | null; error?: string } => {
    const text = String(value ?? "").trim();
    if (!text) return { value: null };
    try {
      const price = new Decimal(text);
      if (price.isFinite() && price.greaterThan(0)) return { value: price };
    } catch { /* handled below */ }
    return { value: null, error: `${label} must be greater than zero` };
  };
  const stop = optionalPrice(body.stopLoss, "Stop-loss");
  const target = optionalPrice(body.takeProfit, "Take-profit");
  if (stop.error || target.error) return NextResponse.json({ error: stop.error ?? target.error }, { status: 400 });
  let marginDelta: Decimal;
  try {
    marginDelta = new Decimal(String(body.marginDelta ?? "0").trim() || "0");
  } catch {
    return NextResponse.json({ error: "Margin adjustment must be a number" }, { status: 400 });
  }
  if (!marginDelta.isFinite()) return NextResponse.json({ error: "Margin adjustment must be finite" }, { status: 400 });
  const entry = new Decimal(current.entryPrice);
  const side = current.side as FuturesSide;
  if (side === "LONG" && stop.value && stop.value.greaterThanOrEqualTo(entry)) return NextResponse.json({ error: "LONG stop-loss must be below entry" }, { status: 400 });
  if (side === "LONG" && target.value && target.value.lessThanOrEqualTo(entry)) return NextResponse.json({ error: "LONG take-profit must be above entry" }, { status: 400 });
  if (side === "SHORT" && stop.value && stop.value.lessThanOrEqualTo(entry)) return NextResponse.json({ error: "SHORT stop-loss must be above entry" }, { status: 400 });
  if (side === "SHORT" && target.value && target.value.greaterThanOrEqualTo(entry)) return NextResponse.json({ error: "SHORT take-profit must be below entry" }, { status: 400 });

  const newMargin = new Decimal(current.margin).plus(marginDelta);
  if (newMargin.lessThanOrEqualTo(0)) return NextResponse.json({ error: "Remaining isolated margin must be greater than zero" }, { status: 400 });
  const coins = await getUserCoins(userId);
  const { prices } = await getPrices(coins);
  const market = await getFuturesMarket(coins, prices);
  const markPrice = market.quotes[current.asset]?.markPrice || prices[current.asset] || Number(current.entryPrice);
  const risk = futuresMetrics({
    side,
    entryPrice: current.entryPrice,
    markPrice,
    margin: newMargin,
    leverage: current.leverage,
    quantity: current.quantity,
    maintenanceMarginRatePercent: current.maintenanceMarginRate ?? "0.5",
    exitFeeRateBps: current.feeRateBps ?? "0",
  });
  if (risk.liquidated) return NextResponse.json({ error: "That margin reduction would put the position below maintenance margin" }, { status: 400 });

  const result = await prisma.$transaction(async (tx) => {
    const position = await tx.futuresPosition.findFirst({ where: { id, userId, status: "OPEN" } });
    if (!position) return { error: "Position is no longer open" } as const;
    const balanceSetting = await tx.setting.findUnique({ where: { userId_key: { userId, key: FUTURES_USD_KEY } } });
    const balance = new Decimal(balanceSetting?.value ?? DEFAULT_FUTURES_USD);
    if (marginDelta.isPositive() && marginDelta.greaterThan(balance)) return { error: "Insufficient available futures balance" } as const;
    const updatedMargin = new Decimal(position.margin).plus(marginDelta);
    if (updatedMargin.lessThanOrEqualTo(0)) return { error: "Position margin changed; retry the adjustment" } as const;
    await tx.setting.upsert({
      where: { userId_key: { userId, key: FUTURES_USD_KEY } },
      create: { userId, key: FUTURES_USD_KEY, value: balance.minus(marginDelta).toString() },
      update: { value: balance.minus(marginDelta).toString() },
    });
    await tx.futuresPosition.update({
      where: { id },
      data: {
        margin: updatedMargin.toString(),
        initialMargin: new Decimal(position.initialMargin ?? position.margin).plus(marginDelta).toString(),
        stopLoss: stop.value?.toString() ?? null,
        takeProfit: target.value?.toString() ?? null,
      },
    });
    return { ok: true } as const;
  });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ ok: true });
}
