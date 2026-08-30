import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

/** Returns the caller's player id (cookie) and signed-in user (null for guests). */
export async function GET(req: NextRequest) {
  const playerId = req.cookies.get("quizora_pid")?.value ?? null;
  const user = await getSessionUser(req);
  return NextResponse.json({ playerId, user });
}
