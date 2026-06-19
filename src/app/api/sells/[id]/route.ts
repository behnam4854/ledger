import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: idParam } = await params;
  const id = Number(idParam);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  try {
    // Deleting a sell automatically restores the buy's remaining quantity,
    // because remaining is derived from the set of sells (not stored).
    await prisma.sell.delete({ where: { id } });
  } catch {
    return NextResponse.json({ error: "Sell not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
