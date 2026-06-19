import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { computeRemaining, dec, realizedProfit } from "@/lib/calculations";
import type { Sell } from "@/lib/types";

export const dynamic = "force-dynamic";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

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

  const buyId = Number(body.buyId);
  const sellDate = String(body.sellDate ?? "").trim();
  if (!Number.isInteger(buyId)) return NextResponse.json({ error: "A position must be selected" }, { status: 400 });
  if (!ISO_DATE.test(sellDate)) return NextResponse.json({ error: "Valid date required" }, { status: 400 });

  let amount, sellPrice;
  try {
    amount = dec(String(body.amount));
    sellPrice = dec(String(body.sellPrice));
  } catch {
    return NextResponse.json({ error: "Amount and sell price must be numbers" }, { status: 400 });
  }
  if (amount.lessThanOrEqualTo(0)) return NextResponse.json({ error: "Amount must be > 0" }, { status: 400 });
  if (sellPrice.lessThanOrEqualTo(0)) return NextResponse.json({ error: "Sell price must be > 0" }, { status: 400 });

  const result = await prisma.$transaction(async (tx) => {
    // Ownership check inside the transaction.
    const buy = await tx.buy.findUnique({ where: { id: buyId } });
    if (!buy || buy.userId !== userId) return { error: "Buy not found", status: 404 as const };

    const existing = await tx.sell.findMany({ where: { buyId } });
    const remaining = dec(
      computeRemaining(
        { ...buy },
        existing.map((s): Sell => ({
          id: s.id,
          buyId: s.buyId,
          amount: s.amount,
          sellPrice: s.sellPrice,
          sellDate: s.sellDate,
          profit: s.profit,
        })),
      ),
    );

    if (amount.greaterThan(remaining.plus("0.000001"))) {
      return { error: `Not enough remaining. Available: ${remaining.toFixed(6)}`, status: 400 as const };
    }

    const profit = realizedProfit(buy.price, amount.toString(), sellPrice.toString());
    const sell = await tx.sell.create({
      data: {
        userId,
        buyId,
        amount: amount.toString(),
        sellPrice: sellPrice.toString(),
        sellDate,
        profit,
      },
    });
    return { sell };
  });

  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.sell, { status: 201 });
}
