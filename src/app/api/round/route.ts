import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/server/game";

export const dynamic = "force-dynamic";

/**
 * GET /api/round?gameId=...&round=N
 * Returns the client-safe view of the current round.
 * BEFORE close: question + options only (no correct_option, no explanation).
 * AFTER close: includes correct_option, explanation, and all answers.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const gameId = searchParams.get("gameId");
  const round = Number(searchParams.get("round"));
  if (!gameId || !Number.isInteger(round) || round < 1)
    return NextResponse.json({ error: "Bad request" }, { status: 400 });

  const db = serviceClient();

  const { data: gq } = await db
    .from("game_questions")
    .select("id, question_id, started_at, deadline_at, closed_at")
    .eq("game_id", gameId)
    .eq("round_number", round)
    .single();
  if (!gq) return NextResponse.json({ error: "Round not found" }, { status: 404 });

  const { data: question } = await db
    .from("questions")
    .select("question, category, subcategory, difficulty, options")
    .eq("id", gq.question_id)
    .single();

  const { count: answerCount } = await db
    .from("answers")
    .select("player_id", { count: "exact", head: true })
    .eq("game_question_id", gq.id);

  const base = {
    roundNumber: round,
    startedAt: gq.started_at,
    deadlineAt: gq.deadline_at,
    closedAt: gq.closed_at,
    answerCount: answerCount ?? 0,
    question: question
      ? {
          question: question.question,
          category: question.category,
          subcategory: question.subcategory,
          difficulty: question.difficulty,
          options: question.options,
        }
      : null,
  };

  if (!gq.closed_at) {
    // Pre-reveal: strictly no correct answer, no explanations, no other players' options.
    return NextResponse.json({ ...base, revealed: false });
  }

  // Post-reveal: full results
  const { data: fullQuestion } = await db
    .from("questions")
    .select("correct_option, explanation")
    .eq("id", gq.question_id)
    .single();

  const { data: answers } = await db
    .from("answers")
    .select("player_id, option, is_correct, points, response_ms")
    .eq("game_question_id", gq.id);

  const { data: players } = await db
    .from("room_players")
    .select("id, display_name")
    .eq(
      "room_id",
      (await db.from("games").select("room_id").eq("id", gameId).single()).data?.room_id
    );
  const nameMap = new Map((players ?? []).map((p: { id: string; display_name: string }) => [p.id, p.display_name]));

  return NextResponse.json({
    ...base,
    revealed: true,
    correctOption: fullQuestion?.correct_option,
    explanation: fullQuestion?.explanation,
    answers: (answers ?? []).map((a: Record<string, unknown>) => ({
      ...a,
      display_name: nameMap.get(a.player_id as string) ?? "Player",
    })),
  });
}
