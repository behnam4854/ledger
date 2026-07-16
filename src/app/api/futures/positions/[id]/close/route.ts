import Decimal from "decimal.js";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { DEFAULT_FUTURES_USD, FUTURES_USD_KEY, getUserCoins, prisma } from "@/lib/db";
import { futuresMetrics, type FuturesSide } from "@/lib/futures";
import { getPrices } from "@/lib/prices";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.user.id);
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid position id" }, { status: 400 });

  const current = await prisma.futuresPosition.findFirst({ where: { id, userId, status: "OPEN" } });
  if (!current) return NextResponse.json({ error: "Open position not found" }, { status: 404 });

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    // An empty body means close at the current live mark.
  }
  const exitText = String(body.exitPrice ?? "").trim();
  let manualExit: Decimal | null = null;
  if (exitText) {
    try {
      manualExit = new Decimal(exitText);
    } catch {
      return NextResponse.json({ error: "Exit price must be a number" }, { status: 400 });
    }
    if (!manualExit.isFinite() || manualExit.lessThanOrEqualTo(0)) {
      return NextResponse.json({ error: "Exit price must be greater than zero" }, { status: 400 });
    }
  }

  let exitPrice = manualExit;
  if (!exitPrice) {
    const coins = await getUserCoins(userId);
    const { prices } = await getPrices(coins);
    const livePrice = prices[current.asset];
    if (livePrice > 0) exitPrice = new Decimal(livePrice);
  }
  if (!exitPrice) {
    return NextResponse.json({ error: "Enter an exit price because no live market price is available" }, { status: 503 });
  }

  const result = await prisma.$transaction(async (tx) => {
    const position = await tx.futuresPosition.findFirst({ where: { id, userId, status: "OPEN" } });
    if (!position) return { error: "Position is already closed" } as const;
    const metrics = futuresMetrics({
      side: position.side as FuturesSide,
      entryPrice: position.entryPrice,
      markPrice: exitPrice,
      margin: position.margin,
      leverage: position.leverage,
      quantity: position.quantity,
    });
    const setting = await tx.setting.findUnique({
      where: { userId_key: { userId, key: FUTURES_USD_KEY } },
    });
    const balance = new Decimal(setting?.value ?? DEFAULT_FUTURES_USD);
    await tx.setting.upsert({
      where: { userId_key: { userId, key: FUTURES_USD_KEY } },
      create: { userId, key: FUTURES_USD_KEY, value: balance.plus(metrics.equity).toString() },
      update: { value: balance.plus(metrics.equity).toString() },
    });
    await tx.futuresPosition.update({
      where: { id },
      data: {
        status: "CLOSED",
        exitPrice: exitPrice.toString(),
        realizedPnl: metrics.pnl,
        closedAt: new Date(),
      },
    });
    return { pnl: metrics.pnl } as const;
  });

  if ("error" in result) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json({ pnl: result.pnl });
}
