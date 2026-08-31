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
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const db = serviceClient();
  const { data: room } = await db
    .from("rooms")
    .select("id, status")
    .eq("id", parsed.data.roomId)
    .single();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  // HOST CHECK (SECURITY): caller must be the room host — logged-in host
  // user OR guest pid cookie matching the host room_player row.
  const pid = req.cookies.get("quizora_pid")?.value ?? "";
  const { data: hostRow } = await db
    .from("room_players")
    .select("id, user_id, is_host")
    .eq("room_id", room.id)
    .eq("is_host", true)
    .maybeSingle();
  const host = hostRow as { id: string; user_id: string | null } | null;
  const isHost =
    (!!user && !!host && host.user_id === user.id) ||
    (!!pid && !!host && host.id === pid);
  if (!isHost) return NextResponse.json({ error: "Host only" }, { status: 403 });

  if (room.status === "closed") return NextResponse.json({ ok: true });

  const { error } = await db
    .from("rooms")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("id", room.id);
  if (error) return NextResponse.json({ error: "Close failed" }, { status: 400 });
  return NextResponse.json({ ok: true });
}
