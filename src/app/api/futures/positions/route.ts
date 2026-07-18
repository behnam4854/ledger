import Decimal from "decimal.js";
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { DEFAULT_FUTURES_USD, FUTURES_USD_KEY, getUserCoins, prisma } from "@/lib/db";
import { futuresFee, futuresMetrics, type FuturesSide } from "@/lib/futures";
import { getPrices } from "@/lib/prices";

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

  const asset = String(body.asset ?? "").trim().toUpperCase();
  const side = String(body.side ?? "").toUpperCase() as FuturesSide;
  const leverage = Number(body.leverage);
  let margin: Decimal;
  try {
    margin = new Decimal(String(body.margin ?? ""));
  } catch {
    return NextResponse.json({ error: "Enter a valid margin amount" }, { status: 400 });
  }
  if (side !== "LONG" && side !== "SHORT") {
    return NextResponse.json({ error: "Choose LONG or SHORT" }, { status: 400 });
  }
  if (!Number.isInteger(leverage) || leverage < 1 || leverage > 20) {
    return NextResponse.json({ error: "Leverage must be between 1x and 20x" }, { status: 400 });
  }
  if (!margin.isFinite() || margin.lessThanOrEqualTo(0)) {
    return NextResponse.json({ error: "Margin must be greater than zero" }, { status: 400 });
  }

  const parseOptionalPrice = (value: unknown): Decimal | null => {
    const text = String(value ?? "").trim();
    if (!text) return null;
    try {
      const price = new Decimal(text);
      return price.isFinite() && price.greaterThan(0) ? price : null;
    } catch {
      return null;
    }
  };
  const entryPriceInput = parseOptionalPrice(body.entryPrice);
  const stopLoss = parseOptionalPrice(body.stopLoss);
  const takeProfit = parseOptionalPrice(body.takeProfit);
  const riskPercent = parseOptionalPrice(body.riskPercent);
  let feeRateBps: Decimal;
  let fundingRate: Decimal;
  try {
    feeRateBps = new Decimal(String(body.feeRateBps ?? "5"));
    fundingRate = new Decimal(String(body.fundingRate ?? "0.01"));
  } catch {
    return NextResponse.json({ error: "Enter valid fee and funding rates" }, { status: 400 });
  }
  const fundingIntervalHours = Number(body.fundingIntervalHours ?? 8);
  let maintenanceMarginRate: Decimal;
  try {
    maintenanceMarginRate = new Decimal(String(body.maintenanceMarginRate ?? "0.5"));
  } catch {
    return NextResponse.json({ error: "Enter a valid maintenance-margin rate" }, { status: 400 });
  }
  if (String(body.entryPrice ?? "").trim() && !entryPriceInput) {
    return NextResponse.json({ error: "Entry price must be greater than zero" }, { status: 400 });
  }
  if (String(body.stopLoss ?? "").trim() && !stopLoss) {
    return NextResponse.json({ error: "Stop-loss must be greater than zero" }, { status: 400 });
  }
  if (String(body.takeProfit ?? "").trim() && !takeProfit) {
    return NextResponse.json({ error: "Take-profit must be greater than zero" }, { status: 400 });
  }
  if (riskPercent && riskPercent.greaterThan(100)) {
    return NextResponse.json({ error: "Risk percentage must be between 0 and 100" }, { status: 400 });
  }
  if (!feeRateBps.isFinite() || feeRateBps.isNegative() || feeRateBps.greaterThan(1000)) {
    return NextResponse.json({ error: "Fee rate must be between 0 and 1,000 bps" }, { status: 400 });
  }
  if (!fundingRate.isFinite() || fundingRate.abs().greaterThan(10)) {
    return NextResponse.json({ error: "Funding rate must be between -10% and 10%" }, { status: 400 });
  }
  if (!Number.isInteger(fundingIntervalHours) || fundingIntervalHours < 1 || fundingIntervalHours > 168) {
    return NextResponse.json({ error: "Funding interval must be between 1 and 168 hours" }, { status: 400 });
  }
  if (!maintenanceMarginRate.isFinite() || maintenanceMarginRate.isNegative() || maintenanceMarginRate.greaterThanOrEqualTo(100)) {
    return NextResponse.json({ error: "Maintenance margin must be between 0% and 100%" }, { status: 400 });
  }
  if (maintenanceMarginRate.plus(feeRateBps.div(100)).greaterThanOrEqualTo(100)) {
    return NextResponse.json({ error: "Maintenance margin plus the closing fee must be below 100%" }, { status: 400 });
  }

  const coins = await getUserCoins(userId);
  if (!coins.some((coin) => coin.symbol === asset)) {
    return NextResponse.json({ error: "Enable this coin in the Portfolio tab first" }, { status: 400 });
  }
  const { prices } = await getPrices(coins);
  const livePrice = prices[asset];
  const entryPrice = entryPriceInput ?? (livePrice > 0 ? new Decimal(livePrice) : null);
  if (!entryPrice) {
    return NextResponse.json({ error: "Enter an entry price because no live market price is available" }, { status: 503 });
  }
  if (side === "LONG" && stopLoss && stopLoss.greaterThanOrEqualTo(entryPrice)) {
    return NextResponse.json({ error: "For a LONG, stop-loss must be below entry price" }, { status: 400 });
  }
  if (side === "LONG" && takeProfit && takeProfit.lessThanOrEqualTo(entryPrice)) {
    return NextResponse.json({ error: "For a LONG, take-profit must be above entry price" }, { status: 400 });
  }
  if (side === "SHORT" && stopLoss && stopLoss.lessThanOrEqualTo(entryPrice)) {
    return NextResponse.json({ error: "For a SHORT, stop-loss must be above entry price" }, { status: 400 });
  }
  if (side === "SHORT" && takeProfit && takeProfit.greaterThanOrEqualTo(entryPrice)) {
    return NextResponse.json({ error: "For a SHORT, take-profit must be below entry price" }, { status: 400 });
  }
  const metrics = futuresMetrics({
    side,
    entryPrice,
    markPrice: entryPrice,
    margin,
    leverage,
    maintenanceMarginRatePercent: maintenanceMarginRate,
    exitFeeRateBps: feeRateBps,
  });
  const entryFee = new Decimal(futuresFee(metrics.notional, feeRateBps));

  const result = await prisma.$transaction(async (tx) => {
    const setting = await tx.setting.findUnique({
      where: { userId_key: { userId, key: FUTURES_USD_KEY } },
    });
    const balance = new Decimal(setting?.value ?? DEFAULT_FUTURES_USD);
    const openingCost = margin.plus(entryFee);
    if (openingCost.greaterThan(balance)) return { error: "Insufficient balance for margin and entry fee" } as const;

    await tx.setting.upsert({
      where: { userId_key: { userId, key: FUTURES_USD_KEY } },
      create: { userId, key: FUTURES_USD_KEY, value: balance.minus(openingCost).toString() },
      update: { value: balance.minus(openingCost).toString() },
    });
    const position = await tx.futuresPosition.create({
      data: {
        userId,
        asset,
        side,
        leverage,
        margin: margin.toString(),
        quantity: metrics.quantity,
        initialQuantity: metrics.quantity,
        initialMargin: margin.toString(),
        entryPrice: entryPrice.toString(),
        stopLoss: stopLoss?.toString() ?? null,
        takeProfit: takeProfit?.toString() ?? null,
        riskPercent: riskPercent?.toString() ?? null,
        plannedRisk: stopLoss
          ? new Decimal(metrics.quantity).times(entryPrice.minus(stopLoss).abs()).toString()
          : null,
        feeRateBps: feeRateBps.toString(),
        entryFee: entryFee.toString(),
        fundingRate: fundingRate.toString(),
        fundingIntervalHours,
        maintenanceMarginRate: maintenanceMarginRate.toString(),
        autoCloseEnabled: body.autoCloseEnabled !== false,
      },
    });
    return { position } as const;
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ id: result.position.id }, { status: 201 });
}
