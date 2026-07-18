import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserCoins } from "@/lib/db";
import { getFuturesMarket } from "@/lib/futures-market";
import { getPrices } from "@/lib/prices";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const coins = await getUserCoins(Number(session.user.id));
  const { prices } = await getPrices(coins);
  return NextResponse.json(await getFuturesMarket(coins, prices));
}
