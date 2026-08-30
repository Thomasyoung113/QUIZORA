import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serviceClient } from "@/lib/server/game";

export const dynamic = "force-dynamic";

const reportSchema = z.object({
  questionId: z.string().uuid(),
  gameId: z.string().uuid().nullish(),
  playerId: z.string().uuid().nullish(),
  reason: z.enum(["wrong_answer", "unclear", "typo", "inappropriate", "other"]),
  details: z.string().max(500).nullish(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = reportSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid report" }, { status: 400 });

  const db = serviceClient();
  const { questionId, gameId, playerId, reason, details } = parsed.data;

  const { data: question, error: qErr } = await db
    .from("questions")
    .select("id")
    .eq("id", questionId)
    .single();
  if (qErr || !question) return NextResponse.json({ error: "Question not found" }, { status: 404 });

  // Rate limit: max 5 reports per player per question per hour
  if (playerId) {
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const { count } = await db
      .from("question_reports")
      .select("id", { count: "exact", head: true })
      .eq("player_id", playerId)
      .eq("question_id", questionId)
      .gte("created_at", since);
    if ((count ?? 0) >= 5)
      return NextResponse.json({ error: "Too many reports" }, { status: 429 });
  }

  const { error } = await db.from("question_reports").insert({
    question_id: questionId,
    game_id: gameId ?? null,
    player_id: playerId ?? null,
    reason,
    details: details?.trim() || null,
  });
  if (error) return NextResponse.json({ error: "Could not save report" }, { status: 500 });

  return NextResponse.json({ ok: true });
}
