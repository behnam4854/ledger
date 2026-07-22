import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { recordFuturesActivity } from "@/lib/futures-activity";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.user.id);
  const id = Number((await params).id);
  let body: { enabled?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (typeof body.enabled !== "boolean") return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  const enabled = body.enabled;
  const result = await prisma.$transaction(async (tx) => {
    const position = await tx.futuresPosition.findFirst({ where: { id, userId, status: "OPEN" } });
    if (!position) return null;
    await tx.futuresPosition.update({ where: { id }, data: { autoCloseEnabled: enabled } });
    await recordFuturesActivity(tx, {
      userId, positionId: id, asset: position.asset, side: position.side,
      action: "AUTOMATION_CHANGED",
      summary: `${enabled ? "Enabled" : "Disabled"} automatic exits for ${position.asset} ${position.side}`,
      details: { previousEnabled: position.autoCloseEnabled, enabled },
    });
    return true;
  });
  if (!result) return NextResponse.json({ error: "Open position not found" }, { status: 404 });
  return NextResponse.json({ enabled });
}
