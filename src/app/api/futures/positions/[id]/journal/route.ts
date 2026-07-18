import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = Number(session.user.id);
  const id = Number((await params).id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Invalid position id" }, { status: 400 });
  const position = await prisma.futuresPosition.findFirst({ where: { id, userId } });
  if (!position) return NextResponse.json({ error: "Position not found" }, { status: 404 });
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const setup = String(body.setup ?? "").trim();
  const tags = String(body.tags ?? "").trim();
  const notes = String(body.notes ?? "").trim();
  const screenshot = String(body.screenshot ?? "").trim();
  if (setup.length > 120) return NextResponse.json({ error: "Setup is limited to 120 characters" }, { status: 400 });
  if (tags.length > 240) return NextResponse.json({ error: "Tags are limited to 240 characters" }, { status: 400 });
  if (notes.length > 10_000) return NextResponse.json({ error: "Notes are limited to 10,000 characters" }, { status: 400 });
  const validScreenshot = !screenshot || /^https:\/\//i.test(screenshot) || /^data:image\/(png|jpeg|webp|gif);base64,/i.test(screenshot);
  if (!validScreenshot) return NextResponse.json({ error: "Screenshot must be an HTTPS URL or an attached image" }, { status: 400 });
  if (screenshot.length > 2_750_000) return NextResponse.json({ error: "Screenshot must be smaller than 2 MB" }, { status: 400 });
  await prisma.futuresPosition.update({
    where: { id },
    data: {
      journalSetup: setup || null,
      journalTags: tags || null,
      journalNotes: notes || null,
      journalScreenshot: screenshot || null,
    },
  });
  return NextResponse.json({ ok: true });
}
