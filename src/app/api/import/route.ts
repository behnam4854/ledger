import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { dec, realizedProfit } from "@/lib/calculations";

export const dynamic = "force-dynamic";

interface ImportBuy {
  wallet?: string;
  asset?: string;
  amount?: string | number;
  price?: string | number;
  date?: string;
}

interface ImportSell {
  asset?: string;
  amount?: string | number;
  sellPrice?: string | number;
  sellDate?: string;
  profit?: string | number;
}

function toDecOrNull(v: unknown): string | null {
  try {
    const d = dec(String(v));
    return d.isFinite() ? d.toString() : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.user.id);

  let body: { buys?: ImportBuy[]; sells?: ImportSell[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const incomingBuys = Array.isArray(body.buys) ? body.buys : [];
  const incomingSells = Array.isArray(body.sells) ? body.sells : [];

  const result = await prisma.$transaction(async (tx) => {
    let importedBuys = 0;
    let importedSells = 0;
    let skippedSells = 0;

    const created: { id: number; asset: string; price: string }[] = [];

    for (const raw of incomingBuys) {
      const amount = toDecOrNull(raw.amount);
      const price = toDecOrNull(raw.price);
      const date = String(raw.date ?? "").trim();
      if (!amount || !price || !date) continue;

      const buy = await tx.buy.create({
        data: {
          userId,
          wallet: String(raw.wallet ?? "Main").trim() || "Main",
          asset: String(raw.asset ?? "BTC").trim().toUpperCase() || "BTC",
          amount,
          price,
          date,
        },
      });
      created.push({ id: buy.id, asset: buy.asset, price: buy.price });
      importedBuys++;
    }

    // Also consider pre-existing buys for this user for sell matching.
    const existingBuys = await tx.buy.findMany({ where: { userId } });
    const matchPool = existingBuys.map((b) => ({ id: b.id, asset: b.asset, price: b.price }));

    for (const raw of incomingSells) {
      const amount = toDecOrNull(raw.amount);
      const sellPrice = toDecOrNull(raw.sellPrice);
      const sellDate = String(raw.sellDate ?? "").trim();
      const asset = String(raw.asset ?? "").trim().toUpperCase();
      if (!amount || !sellPrice || !sellDate) continue;

      const sellPriceDec = dec(sellPrice);
      const match = matchPool.find(
        (b) =>
          b.asset === asset &&
          dec(b.price).minus(sellPriceDec).abs().lessThan(dec(b.price).times("0.1")),
      );

      if (!match) {
        skippedSells++;
        continue;
      }

      const provided = toDecOrNull(raw.profit);
      const profit = provided ?? realizedProfit(match.price, amount, sellPrice);

      await tx.sell.create({
        data: { userId, buyId: match.id, amount, sellPrice, sellDate, profit },
      });
      importedSells++;
    }

    return { importedBuys, importedSells, skippedSells };
  });

  return NextResponse.json(result);
}
