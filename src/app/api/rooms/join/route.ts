import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { hashToken, joinRoom, newGuestToken, serviceClient } from "@/lib/server/game";

export const dynamic = "force-dynamic";

const COOKIES = {
  playerId: "quizora_pid",
  guestToken: "quizora_guest",
  roomCode: "quizora_room",
} as const;

const joinSchema = z.object({
  code: z.string().min(4).max(8),
  displayName: z.string().min(1).max(24),
});

function baseCookie() {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
  };
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = joinSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });

  const db = serviceClient();
  const { data: room } = await db
    .from("rooms")
    .select("id")
    .eq("room_code", parsed.data.code.toUpperCase())
    .single();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  // Reuse existing guest token so reconnects map back to the same player row
  const existingToken = req.cookies.get(COOKIES.guestToken)?.value;
  const guestToken = existingToken ?? newGuestToken().token;
  const guestHash = hashToken(guestToken);

  const result = await joinRoom(db, room.id, parsed.data.displayName, null, guestHash);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  const res = NextResponse.json({ playerId: result.playerId });
  const c = baseCookie();
  res.cookies.set(COOKIES.playerId, result.playerId!, c);
  if (!existingToken) res.cookies.set(COOKIES.guestToken, guestToken, c);
  res.cookies.set(COOKIES.roomCode, parsed.data.code.toUpperCase(), c);
  return res;
}
