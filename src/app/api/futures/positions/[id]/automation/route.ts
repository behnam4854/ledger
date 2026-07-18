import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.user.id);
  const id = Number((await params).id);
  let body: { enabled?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  const result = await prisma.futuresPosition.updateMany({
    where: { id, userId, status: "OPEN" },
    data: { autoCloseEnabled: body.enabled },
  });
  if (!result.count) return NextResponse.json({ error: "Open position not found" }, { status: 404 });
  return NextResponse.json({ enabled: body.enabled });
}
