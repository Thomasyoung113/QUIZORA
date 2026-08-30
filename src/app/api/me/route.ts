import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Returns the caller's player id from the cookie (null if not in a room). */
export async function GET(_req: NextRequest) {
  const playerId = _req.cookies.get("quizora_pid")?.value ?? null;
  return NextResponse.json({ playerId });
}
