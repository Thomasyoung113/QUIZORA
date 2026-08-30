import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createRoomWithCode, newGuestToken, serviceClient } from "@/lib/server/game";

export const dynamic = "force-dynamic";

const COOKIES = {
  playerId: "quizora_pid",
  guestToken: "quizora_guest",
  roomCode: "quizora_room",
} as const;

const createSchema = z.object({
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
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid name" }, { status: 400 });

  const db = serviceClient();
  const guest = newGuestToken();
  const { room, player } = await createRoomWithCode(db, parsed.data.displayName, null, guest.hash);

  const res = NextResponse.json({ roomCode: room.room_code, playerId: player.id });
  const c = baseCookie();
  res.cookies.set(COOKIES.playerId, player.id, c);
  res.cookies.set(COOKIES.guestToken, guest.token, c);
  res.cookies.set(COOKIES.roomCode, room.room_code, c);
  return res;
}
