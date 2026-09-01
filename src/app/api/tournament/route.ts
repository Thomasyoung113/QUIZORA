import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/server/auth";
import { serviceClient } from "@/lib/server/game";
import { seedBracket, tryAdvance } from "@/lib/server/tournament";
import { rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  action: z.literal("create"),
  size: z.union([z.literal(4), z.literal(8), z.literal(16)]),
  difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
  categories: z.array(z.string().min(1)).min(1).max(5),
  timer_seconds: z.union([z.literal(5), z.literal(10), z.literal(15), z.literal(30), z.literal(60)]).default(15),
  rounds_per_match: z.number().int().min(1).max(20).default(5),
});

const joinSchema = z.object({ action: z.literal("join"), code: z.string().length(6) });
const startSchema = z.object({ action: z.literal("start"), tournamentId: z.string().uuid() });
const advanceSchema = z.object({ action: z.literal("advance"), tournamentId: z.string().uuid(), matchId: z.string().uuid() });
const stateSchema = z.object({ action: z.literal("state"), tournamentId: z.string().uuid() });

const bodySchema = z.discriminatedUnion("action", [
  createSchema,
  joinSchema,
  startSchema,
  advanceSchema,
  stateSchema,
]);

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function genCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

export async function POST(req: NextRequest) {
  const user = await getSessionUser(req);
  if (!user) return NextResponse.json({ error: "Login required" }, { status: 401 });

  // One write per second per user is plenty for tournaments
  if (!rateLimit(`t:${user.id}`, 5, 10_000)) {
    return NextResponse.json({ error: "Slow down" }, { status: 429 });
  }

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const input = parsed.data;
  const db = serviceClient();

  switch (input.action) {
    case "create": {
      // Host is automatically entry #1
      const { data: profile } = await db.from("profiles").select("username").eq("id", user.id).single();
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = genCode();
        const { data: t, error } = await db
          .from("tournaments")
          .insert({
            code,
            host_id: user.id,
            size: input.size,
            difficulty: input.difficulty,
            categories: input.categories,
            timer_seconds: input.timer_seconds,
            rounds_per_match: input.rounds_per_match,
          })
          .select("id, code")
          .single();
        if (error) continue; // code collision -> retry
        await db.from("tournament_entries").insert({
          tournament_id: t.id,
          user_id: user.id,
          display_name: profile?.username ?? "Host",
        });
        return NextResponse.json({ ok: true, tournamentId: t.id, code: t.code });
      }
      return NextResponse.json({ error: "Could not create tournament" }, { status: 500 });
    }

    case "join": {
      const { data: t } = await db
        .from("tournaments")
        .select("id, status, size")
        .eq("code", input.code.toUpperCase())
        .single();
      if (!t) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
      if (t.status !== "lobby") return NextResponse.json({ error: "Tournament already started" }, { status: 400 });
      const { count } = await db
        .from("tournament_entries")
        .select("id", { count: "exact", head: true })
        .eq("tournament_id", t.id);
      if ((count ?? 0) >= t.size) return NextResponse.json({ error: "Tournament full" }, { status: 400 });
      const { data: profile } = await db.from("profiles").select("username").eq("id", user.id).single();
      const { error } = await db.from("tournament_entries").upsert(
        { tournament_id: t.id, user_id: user.id, display_name: profile?.username ?? "Player" },
        { onConflict: "tournament_id,user_id" }
      );
      if (error) return NextResponse.json({ error: "Join failed" }, { status: 400 });
      // Capacity re-check after insert (atomic-ish guard against parallel
      // join floods racing past the pre-check): evict the just-added row if
      // the tournament is somehow over capacity.
      const { count: postCount } = await db
        .from("tournament_entries")
        .select("id", { count: "exact", head: true })
        .eq("tournament_id", t.id);
      if ((postCount ?? 0) > t.size) {
        await db.from("tournament_entries").delete().eq("tournament_id", t.id).eq("user_id", user.id);
        return NextResponse.json({ error: "Tournament full" }, { status: 400 });
      }
      return NextResponse.json({ ok: true, tournamentId: t.id });
    }

    case "start": {
      const { data: t } = await db
        .from("tournaments")
        .select("id, host_id, status, size, difficulty, categories, timer_seconds, rounds_per_match")
        .eq("id", input.tournamentId)
        .single();
      if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });
      if (t.host_id !== user.id) return NextResponse.json({ error: "Host only" }, { status: 403 });
      if (t.status !== "lobby") return NextResponse.json({ error: "Already started" }, { status: 400 });
      const result = await seedBracket(db, t);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    case "advance": {
      // Any participant may ping advance; tryAdvance is idempotent.
      const { data: entry } = await db
        .from("tournament_entries")
        .select("id")
        .eq("tournament_id", input.tournamentId)
        .eq("user_id", user.id)
        .single();
      if (!entry) return NextResponse.json({ error: "Not a participant" }, { status: 403 });
      const result = await tryAdvance(db, input.tournamentId, input.matchId);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json(result);
    }

    case "state": {
      const { data: t } = await db
        .from("tournaments")
        .select("id, code, host_id, status, size, difficulty, categories, timer_seconds, rounds_per_match, champion_user_id, started_at, finished_at")
        .eq("id", input.tournamentId)
        .single();
      if (!t) return NextResponse.json({ error: "Not found" }, { status: 404 });
      const [{ data: entries }, { data: matches }] = await Promise.all([
        db.from("tournament_entries").select("id, user_id, display_name, seed, eliminated_in").eq("tournament_id", t.id).order("seed", { ascending: true, nullsFirst: false }),
        db.from("tournament_matches").select("id, bracket_round, match_slot, room_id, player_a_id, player_b_id, winner_entry_id, status").eq("tournament_id", t.id).order("bracket_round").order("match_slot"),
      ]);
      // Resolve room codes so clients can navigate to their match
      const roomIds = (matches ?? []).map((m: { room_id: string | null }) => m.room_id).filter(Boolean);
      const { data: rooms } = roomIds.length
        ? await db.from("rooms").select("id, room_code, status").in("id", roomIds)
        : { data: [] };
      const roomById = Object.fromEntries((rooms ?? []).map((r: { id: string; room_code: string; status: string }) => [r.id, r]));
      return NextResponse.json({
        ok: true,
        tournament: t,
        entries: entries ?? [],
        matches: (matches ?? []).map((m: { room_id: string | null }) => ({ ...m, room: m.room_id ? roomById[m.room_id] ?? null : null })),
      });
    }
  }
}
