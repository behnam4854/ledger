import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const requestedPage = Number(req.nextUrl.searchParams.get("page") ?? 1);
  const requestedPageSize = Number(req.nextUrl.searchParams.get("pageSize") ?? req.nextUrl.searchParams.get("limit") ?? 100);
  const page = Number.isFinite(requestedPage) ? Math.max(1, Math.floor(requestedPage)) : 1;
  const pageSize = Number.isFinite(requestedPageSize) ? Math.min(50, Math.max(1, Math.floor(requestedPageSize))) : 50;
  const assetParam = String(req.nextUrl.searchParams.get("asset") ?? "").trim().toUpperCase();
  const userId = Number(session.user.id);
  const where = { userId, ...(assetParam && assetParam !== "ALL" ? { asset: assetParam } : {}) };
  const [rows, total, assetRows] = await Promise.all([
    prisma.futuresActivity.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.futuresActivity.count({ where }),
    prisma.futuresActivity.findMany({ where: { userId }, distinct: ["asset"], select: { asset: true }, orderBy: { asset: "asc" } }),
  ]);
  return NextResponse.json({
    activities: rows.map(({ userId: _userId, details, ...activity }) => {
      let parsed: Record<string, string | number | boolean | null> = {};
      try { parsed = JSON.parse(details) as typeof parsed; } catch { /* retain an empty detail object */ }
      return { ...activity, details: parsed };
    }),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    assets: assetRows.map((row) => row.asset),
  });
}
