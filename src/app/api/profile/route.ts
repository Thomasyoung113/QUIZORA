import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/game";
import { isPresetSlug, presetAvatarDataUri } from "@/lib/avatars";

export const dynamic = "force-dynamic";

export const RANK_TIERS = [
  { name: "Bronze", min: 0, max: 1100, color: "#CD7F32" },
  { name: "Silver", min: 1100, max: 1300, color: "#C0C0C0" },
  { name: "Gold", min: 1300, max: 1600, color: "#FBBF24" },
  { name: "Platinum", min: 1600, max: 2000, color: "#7DD3FC" },
  { name: "Diamond", min: 2000, max: Infinity, color: "#60A5FA" },
] as const;

export function rankFor(rating: number) {
  const idx = RANK_TIERS.findIndex((t) => rating < t.max);
  const tier = RANK_TIERS[idx < 0 ? RANK_TIERS.length - 1 : idx];
  const next = RANK_TIERS[idx + 1] ?? null;
  const progress = next ? Math.min(100, Math.max(0, ((rating - tier.min) / (next.min - tier.min)) * 100)) : 100;
  return { tier: tier.name, color: tier.color, rating, nextTier: next?.name ?? null, progress: Math.round(progress) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function resolveAvatarUrl(row: any): string | null {
  if (!row?.avatar_url) return null;
  if (isPresetSlug(row.avatar_url)) return presetAvatarDataUri(row.avatar_url);
  return row.avatar_url;
}

/** GET /api/profile — full profile for the signed-in user. */
export async function GET(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const db = serviceClient();
  const { data: profile } = await db.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });

  const [catalog, unlocked, games, catStats] = await Promise.all([
    db.from("achievement_catalog").select("id,name,description,tier,sort_order").order("sort_order"),
    db.from("profile_achievements").select("achievement_id,unlocked_at").eq("user_id", user.id),
    db.from("game_results").select("*").eq("user_id", user.id).order("finished_at", { ascending: false }).limit(15),
    db.from("player_category_stats").select("*").eq("user_id", user.id).order("wins", { ascending: false }),
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
      avatarRaw: profile.avatar_url,
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

/** PATCH /api/profile — update username and/or avatar. */
export async function PATCH(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });

  const patch: Record<string, unknown> = {};

  if (typeof body.username === "string") {
    const username = body.username.trim();
    if (username.length < 3 || username.length > 24) {
      return NextResponse.json({ error: "Username must be 3-24 characters" }, { status: 400 });
    }
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return NextResponse.json({ error: "Letters, numbers and underscores only" }, { status: 400 });
    }
    const { data: clash } = await serviceClient()
      .from("profiles")
      .select("id")
      .eq("username", username)
      .neq("id", user.id)
      .maybeSingle();
    if (clash) return NextResponse.json({ error: "Username already taken" }, { status: 409 });
    patch.username = username;
  }

  if (typeof body.avatar === "string") {
    const isPreset = isPresetSlug(body.avatar);
    const isUpload = /^https?:\/\/.+\/avatars\/.+/.test(body.avatar);
    if (!isPreset && !isUpload) {
      return NextResponse.json({ error: "Invalid avatar" }, { status: 400 });
    }
    patch.avatar_url = body.avatar;
  }

  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const db = serviceClient();
  const { data, error } = await db
    .from("profiles")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", user.id)
    .select("username,avatar_url")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    profile: { username: data.username, avatarUrl: resolveAvatarUrl(data), avatarRaw: data.avatar_url },
  });
}
