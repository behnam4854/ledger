import { NextResponse, type NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { getUserCoins, prisma } from "@/lib/db";
import { fetchCoinGeckoCoin } from "@/lib/prices";
import { CORE_COINS } from "@/lib/types";

const SYMBOL_RE = /^[A-Z0-9._-]{1,15}$/;
const COINGECKO_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ coins: await getUserCoins(Number(session.user.id)) });
}

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

  const coingeckoId = String(body.coingeckoId ?? "").trim().toLowerCase();
  if (!COINGECKO_ID_RE.test(coingeckoId)) {
    return NextResponse.json({ error: "Choose a coin from the search results" }, { status: 400 });
  }

  const existingCoins = await getUserCoins(userId);
  if (existingCoins.some((coin) => coin.coingeckoId === coingeckoId)) {
    return NextResponse.json({ error: "This coin is already added" }, { status: 409 });
  }

  let verified: Awaited<ReturnType<typeof fetchCoinGeckoCoin>>;
  try {
    verified = await fetchCoinGeckoCoin(coingeckoId);
  } catch {
    return NextResponse.json({ error: "Could not verify the coin with CoinGecko. Try again shortly." }, { status: 502 });
  }
  if (!verified) {
    return NextResponse.json({ error: "CoinGecko could not verify that coin" }, { status: 400 });
  }

  const { symbol, name } = verified;
  if (!SYMBOL_RE.test(symbol) || name.length > 60) {
    return NextResponse.json({ error: "That coin uses a symbol or name LEDGRS cannot store" }, { status: 400 });
  }
  if (CORE_COINS.some((coin) => coin.symbol === symbol || coin.coingeckoId === coingeckoId)) {
    return NextResponse.json({ error: "This coin is already added" }, { status: 409 });
  }

  try {
    const coin = await prisma.coin.create({ data: { userId, symbol, name, coingeckoId } });
    return NextResponse.json(
      { coin: { symbol: coin.symbol, name: coin.name, coingeckoId: coin.coingeckoId, builtIn: false } },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return NextResponse.json({ error: "This coin is already added" }, { status: 409 });
    }
    throw error;
  }
}
