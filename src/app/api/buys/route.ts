import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { dec } from "@/lib/calculations";

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

  const wallet = String(body.wallet ?? "").trim();
  const asset = String(body.asset ?? "").trim().toUpperCase();
  const date = String(body.date ?? "").trim();

  if (!wallet) return NextResponse.json({ error: "Wallet is required" }, { status: 400 });
  if (!asset) return NextResponse.json({ error: "Asset is required" }, { status: 400 });
  if (!ISO_DATE.test(date)) return NextResponse.json({ error: "Valid date required" }, { status: 400 });

  let amount, price;
  try {
    amount = dec(String(body.amount));
    price = dec(String(body.price));
  } catch {
    return NextResponse.json({ error: "Amount and price must be numbers" }, { status: 400 });
  }
  if (amount.lessThanOrEqualTo(0)) return NextResponse.json({ error: "Amount must be > 0" }, { status: 400 });
  if (price.lessThanOrEqualTo(0)) return NextResponse.json({ error: "Price must be > 0" }, { status: 400 });

  const buy = await prisma.buy.create({
    data: { userId, wallet, asset, amount: amount.toString(), price: price.toString(), date },
  });

  return NextResponse.json(buy, { status: 201 });
}
