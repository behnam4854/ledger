import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const requestedLimit = Number(req.nextUrl.searchParams.get("limit") ?? 100);
  const limit = Number.isFinite(requestedLimit) ? Math.min(200, Math.max(1, Math.floor(requestedLimit))) : 100;
  const rows = await prisma.futuresActivity.findMany({
    where: { userId: Number(session.user.id) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return NextResponse.json({
    activities: rows.map(({ userId: _userId, details, ...activity }) => {
      let parsed: Record<string, string | number | boolean | null> = {};
      try { parsed = JSON.parse(details) as typeof parsed; } catch { /* retain an empty detail object */ }
      return { ...activity, details: parsed };
    }),
  });
}
