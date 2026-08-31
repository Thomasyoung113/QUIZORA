import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/game";

export const dynamic = "force-dynamic";

const schema = z.object({ roomId: z.string().uuid() });

/**
 * Host closes a room. The room is marked closed NOW, but stays "recoverable"
 * for 30 minutes (closed_at set) so an accidental close can be undone by
 * simply re-opening. After 30 min the room is permanently dead and the
 * code stops working for everyone.
 */
export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: "Login required" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const db = serviceClient();
  const { data: room } = await db
    .from("rooms")
    .select("id, status")
    .eq("id", parsed.data.roomId)
    .single();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (room.status === "closed") return NextResponse.json({ ok: true });

  const { error } = await db
    .from("rooms")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("id", room.id);
  if (error) return NextResponse.json({ error: "Close failed" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
