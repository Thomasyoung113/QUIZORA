import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/server/game";

export const dynamic = "force-dynamic";

/**
 * GET /api/room-state?code=XXXXXX
 * Client-safe room snapshot: players, settings-safe game state, scores.
 * Never exposes correct answers.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code")?.toUpperCase();
  if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 });

  const db = serviceClient();

  const { data: room } = await db
    .from("rooms")
    .select("id, room_code, status, max_players")
    .eq("room_code", code)
    .single();
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const { data: players } = await db
    .from("room_players")
    .select("id, display_name, is_host, is_ready, connected")
    .eq("room_id", room.id)
    .is("left_at", null)
    .order("joined_at");

  const { data: game } = await db
    .from("games")
    .select("id, game_mode, difficulty, categories, timer_seconds, total_rounds, current_round, status")
    .eq("room_id", room.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Live scores: sum of points per player for the latest game
  let scores: Record<string, number> = {};
  if (game) {
    const { data: gqs } = await db
      .from("game_questions")
      .select("id")
      .eq("game_id", game.id);
    if (gqs && gqs.length > 0) {
      const { data: answers } = await db
        .from("answers")
        .select("player_id, points")
        .in("game_question_id", gqs.map((g: { id: string }) => g.id))
        .not("points", "is", null);
      for (const a of answers ?? []) {
        scores[a.player_id] = (scores[a.player_id] ?? 0) + (a.points ?? 0);
      }
    }
  }

  return NextResponse.json({
    room,
    players: players ?? [],
    game,
    scores,
  });
}
