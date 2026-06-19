import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.user.id);

  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  // Ownership check — only delete sells belonging to this user.
  const sell = await prisma.sell.findUnique({ where: { id } });
  if (!sell || sell.userId !== userId) {
    return NextResponse.json({ error: "Sell not found" }, { status: 404 });
  }

  try {
    await prisma.sell.delete({ where: { id } });
  } catch {
    return NextResponse.json({ error: "Sell not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
