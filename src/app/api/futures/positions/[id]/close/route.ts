import Decimal from "decimal.js";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserCoins, prisma } from "@/lib/db";
import { closeFuturesPositionAtPrice, FuturesCloseError } from "@/lib/close-futures-position";
import { getFuturesMarket } from "@/lib/futures-market";
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
  const closeQuantityText = String(body.closeQuantity ?? "").trim();
  let requestedCloseQuantity: Decimal | null = null;
  if (closeQuantityText) {
    try {
      requestedCloseQuantity = new Decimal(closeQuantityText);
    } catch {
      return NextResponse.json({ error: "Close quantity must be a number" }, { status: 400 });
    }
    if (!requestedCloseQuantity.isFinite() || requestedCloseQuantity.lessThanOrEqualTo(0)) {
      return NextResponse.json({ error: "Close quantity must be greater than zero" }, { status: 400 });
    }
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
    const market = await getFuturesMarket(coins, prices);
    const livePrice = market.quotes[current.asset]?.markPrice ?? prices[current.asset];
    if (livePrice > 0) exitPrice = new Decimal(livePrice);
  }
  if (!exitPrice) {
    return NextResponse.json({ error: "Enter an exit price because no live market price is available" }, { status: 503 });
  }

  try {
    const result = await closeFuturesPositionAtPrice({
      userId,
      id,
      exitPrice,
      closeQuantity: requestedCloseQuantity ?? undefined,
      reason: "MANUAL",
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof FuturesCloseError) return NextResponse.json({ error: error.message }, { status: error.status });
    throw error;
  }
}
