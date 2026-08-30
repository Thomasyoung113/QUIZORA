import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serviceClient } from "@/lib/server/game";
import { rateLimit, clientIp } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const schema = z.object({
  action: z.enum(["heartbeat", "leave"]),
  gameId: z.string().uuid(),
  playerId: z.string().uuid(),
});

/**
 * Anti-cheat telemetry.
 * - heartbeat: marks player as present this round
 * - leave: flags a deliberate page departure (forfeit signal for the
 *   CURRENT round's scoring — network drops never fire this beacon)
 *
 * Identity is proven the same way as /api/game: quizora_pid cookie must
 * exist; the leave/heartbeat only marks, never scores directly.
 */
export async function POST(req: NextRequest) {
  if (!rateLimit(`anticheat:${clientIp(req)}`, 120, 60 * 1000)) {
    return NextResponse.json({ error: "Too many" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const claimed = req.cookies.get("quizora_pid")?.value;
  if (!claimed || claimed !== parsed.data.playerId) {
    return NextResponse.json({ error: "Identity mismatch" }, { status: 403 });
  }

  const db = serviceClient();
  const { action, gameId, playerId } = parsed.data;

  // Find the current open round's game_question
  const { data: gq } = await db
    .from("game_questions")
    .select("id")
    .eq("game_id", gameId)
    .is("closed_at", null)
    .order("round_number", { ascending: false })
    .limit(1)
    .single();

  if (action === "leave" && gq) {
    // Record a forfeit marker. Scoring treats a forfeit as: no answer + streak reset.
    await db.from("answers").upsert(
      {
        game_question_id: gq.id,
        player_id: playerId,
        option: null,
        forfeited: true,
        submitted_at: new Date().toISOString(),
        response_ms: null,
      },
      { onConflict: "game_question_id,player_id", ignoreDuplicates: true }
    );
  }
  // heartbeats are intentionally not persisted — presence is implied by
  // the ABSENCE of a forfeit marker. No DB write needed.

  return NextResponse.json({ ok: true });
}
