import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const linked = await prisma.sell.count({ where: { buyId: id } });
  if (linked > 0) {
    return NextResponse.json(
      { error: `Cannot delete buy: ${linked} sell(s) linked. Delete sells first.` },
      { status: 409 },
    );
  }

  try {
    await prisma.buy.delete({ where: { id } });
  } catch {
    return NextResponse.json({ error: "Buy not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
