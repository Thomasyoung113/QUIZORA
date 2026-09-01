import { NextRequest, NextResponse } from "next/server";
import { serviceClient } from "@/lib/server/game";
import { rankFor, resolveAvatarUrl } from "../route";

export const dynamic = "force-dynamic";

/** GET /api/profile/[username] — public read-only profile view. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ username: string }> }) {
  const { username } = await ctx.params;
  const db = serviceClient();

  const { data: profile } = await db
    .from("profiles")
    .select("id,username,avatar_url,xp,total_games,total_wins,total_questions,correct_answers,best_streak,avg_answer_ms,rating")
    .eq("username", decodeURIComponent(username))
    .maybeSingle();
  if (!profile) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [catalog, unlocked, games, catStats] = await Promise.all([
    db.from("achievement_catalog").select("id,name,description,tier,sort_order").order("sort_order"),
    db.from("profile_achievements").select("achievement_id,unlocked_at").eq("user_id", profile.id),
    db.from("game_results").select("*").eq("user_id", profile.id).order("finished_at", { ascending: false }).limit(15),
    db.from("player_category_stats").select("*").eq("user_id", profile.id).order("wins", { ascending: false }),
  ]);

  const unlockedMap = new Map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (unlocked.data ?? []).map((u: any) => [u.achievement_id, u.unlocked_at])
  );
  const achievements = (catalog.data ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    tier: c.tier,
    unlocked: unlockedMap.has(c.id),
    unlockedAt: unlockedMap.get(c.id) ?? null,
  }));

  const totalGames = profile.total_games ?? 0;
  const winRate = totalGames > 0 ? Math.round(((profile.total_wins ?? 0) / totalGames) * 100) : 0;

  return NextResponse.json({
    profile: {
      username: profile.username,
      avatarUrl: resolveAvatarUrl(profile),
      xp: profile.xp,
      totalGames,
      totalWins: profile.total_wins,
      totalQuestions: profile.total_questions,
      correctAnswers: profile.correct_answers,
      bestStreak: profile.best_streak,
      avgAnswerMs: profile.avg_answer_ms ?? null,
      rating: profile.rating ?? 1000,
      winRate,
    },
    rank: rankFor(profile.rating ?? 1000),
    achievements,
    games: games.data ?? [],
    categoryStats: catStats.data ?? [],
  });
}
