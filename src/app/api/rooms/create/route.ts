import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createRoomWithCode, newGuestToken, serviceClient } from "@/lib/server/game";
import { ensureProfile, getSessionUser } from "@/lib/server/auth";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";

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
  if (!rateLimit(`create-room:${clientIp(req)}`, 5, 60 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many rooms created. Try again later." }, { status: 429 });
  }
  if (!rateLimit(`create-room-name:${clientIp(req)}`, 20, 60 * 1000)) {
    return NextResponse.json({ error: "Slow down." }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid name" }, { status: 400 });

  const db = serviceClient();
  const user = await getSessionUser(req);
  if (user) await ensureProfile(db, user.id, user.email, parsed.data.displayName);
  const guest = newGuestToken();
  const { room, player } = await createRoomWithCode(db, parsed.data.displayName, user?.id ?? null, guest.hash);

  const res = NextResponse.json({ roomCode: room.room_code, playerId: player.id });
  const c = baseCookie();
  res.cookies.set(COOKIES.playerId, player.id, c);
  res.cookies.set(COOKIES.guestToken, guest.token, c);
  res.cookies.set(COOKIES.roomCode, room.room_code, c);
  return res;
}
