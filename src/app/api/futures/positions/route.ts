import Decimal from "decimal.js";
import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { DEFAULT_FUTURES_USD, FUTURES_USD_KEY, getUserCoins, prisma } from "@/lib/db";
import { futuresMetrics, type FuturesSide } from "@/lib/futures";
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
  if (String(body.entryPrice ?? "").trim() && !entryPriceInput) {
    return NextResponse.json({ error: "Entry price must be greater than zero" }, { status: 400 });
  }
  if (String(body.stopLoss ?? "").trim() && !stopLoss) {
    return NextResponse.json({ error: "Stop-loss must be greater than zero" }, { status: 400 });
  }
  if (String(body.takeProfit ?? "").trim() && !takeProfit) {
    return NextResponse.json({ error: "Take-profit must be greater than zero" }, { status: 400 });
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
  const metrics = futuresMetrics({ side, entryPrice, markPrice: entryPrice, margin, leverage });

  const result = await prisma.$transaction(async (tx) => {
    const setting = await tx.setting.findUnique({
      where: { userId_key: { userId, key: FUTURES_USD_KEY } },
    });
    const balance = new Decimal(setting?.value ?? DEFAULT_FUTURES_USD);
    if (margin.greaterThan(balance)) return { error: "Insufficient futures paper balance" } as const;

    await tx.setting.upsert({
      where: { userId_key: { userId, key: FUTURES_USD_KEY } },
      create: { userId, key: FUTURES_USD_KEY, value: balance.minus(margin).toString() },
      update: { value: balance.minus(margin).toString() },
    });
    const position = await tx.futuresPosition.create({
      data: {
        userId,
        asset,
        side,
        leverage,
        margin: margin.toString(),
        quantity: metrics.quantity,
        entryPrice: entryPrice.toString(),
        stopLoss: stopLoss?.toString() ?? null,
        takeProfit: takeProfit?.toString() ?? null,
      },
    });
    return { position } as const;
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ id: result.position.id }, { status: 201 });
}
