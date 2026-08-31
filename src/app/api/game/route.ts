import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { serviceClient, hashToken } from "@/lib/server/game";
import { getSessionUser } from "@/lib/server/auth";
import {
  beginRound,
  closeRound,
  finishGame,
  rematch,
  startGame,
  submitAnswer,
} from "@/lib/server/state-machine";
import type { GameSettings, PlayerOption } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * SECURITY: resolves the caller's player id from PROOF, not from the
 * client-asserted quizora_pid cookie alone. The claimed pid must match
 * the caller's guest token hash (stored on the player row) or their
 * signed-in user id. Returns null when identity cannot be proven.
 */
async function pid(req: NextRequest): Promise<string | null> {
  const claimed = req.cookies.get("quizora_pid")?.value;
  if (!claimed) return null;

  const db = serviceClient();
  const { data: player } = await db
    .from("room_players")
    .select("id, user_id, guest_token_hash")
    .eq("id", claimed)
    .single();
  if (!player) return null;

  const user = await getSessionUser(req);
  if (user && player.user_id === user.id) return player.id;

  const guestToken = req.cookies.get("quizora_guest")?.value;
  if (guestToken && player.guest_token_hash === hashToken(guestToken)) return player.id;

  return null;
}

const settingsSchema = z.object({
  game_mode: z.enum(["classic", "speed", "mixed"]),
  difficulty: z.enum(["easy", "medium", "hard", "adaptive"]),
  categories: z.array(z.string()).min(1),
  timer_seconds: z.number().int().refine((v) => [5, 10, 15, 30, 60].includes(v)),
  total_rounds: z.number().int().min(1).max(30),
  speed_bonus: z.boolean(),
  streak_bonus: z.boolean(),
  explanations: z.boolean(),
});

const startSchema = z.object({ roomId: z.string().uuid(), settings: settingsSchema });

const answerSchema = z.object({
  gameId: z.string().uuid(),
  roundNumber: z.number().int().positive(),
  option: z.enum(["A", "B", "C", "D"]),
});

const actionSchema = z.object({
  action: z.enum(["start", "answer", "closeRound", "beginRound", "finish", "rematch", "setReady"]),
  roomId: z.string().uuid().optional(),
  gameId: z.string().uuid().optional(),
  roundNumber: z.number().int().positive().optional(),
  settings: settingsSchema.optional(),
  option: z.enum(["A", "B", "C", "D"]).optional(),
  ready: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  const input = parsed.data;
  const playerId = await pid(req);
  if (!playerId) return NextResponse.json({ error: "Not in a room" }, { status: 401 });

  const db = serviceClient();

  switch (input.action) {
    case "setReady": {
      if (!input.roomId || typeof input.ready !== "boolean")
        return NextResponse.json({ error: "Missing fields" }, { status: 400 });
      const { error } = await db
        .from("room_players")
        .update({ is_ready: input.ready })
        .eq("id", playerId)
        .eq("room_id", input.roomId)
        .eq("is_host", false); // host is always ready
      if (error) return NextResponse.json({ error: "Failed" }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    case "start": {
      const s = startSchema.safeParse({ roomId: input.roomId, settings: input.settings });
      if (!s.success) return NextResponse.json({ error: "Invalid settings" }, { status: 400 });
      const settings: GameSettings = {
        game_mode: s.data.settings.game_mode,
        difficulty: s.data.settings.difficulty,
        categories: s.data.settings.categories,
        timer_seconds: s.data.settings.timer_seconds,
        total_rounds: s.data.settings.total_rounds,
        speed_bonus: s.data.settings.speed_bonus,
        streak_bonus: s.data.settings.streak_bonus,
        explanations: s.data.settings.explanations,
      };

      // Select questions server-side: approved + matching filters, excluding used-in-game.
      // PostgREST can't do ORDER BY random(), so pull a wide sample then
      // shuffle client-side and take what we need.
      let query = db
        .from("questions")
        .select("id")
        .eq("status", "approved")
        .in("category", settings.categories)
        .limit(400);
      if (settings.difficulty !== "adaptive") {
        query = query.eq("difficulty", settings.difficulty);
      }
      const { data: qs, error: qErr } = await query;
      if (qErr || !qs || qs.length < settings.total_rounds)
        return NextResponse.json(
          { error: `Not enough questions (${qs?.length ?? 0}/${settings.total_rounds}). Add more or widen filters.` },
          { status: 400 }
        );
      // Fisher-Yates shuffle for uniform randomness
      const pool = [...qs];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      const shuffled = pool.slice(0, settings.total_rounds);

      const result = await startGame(db, s.data.roomId, playerId, settings, shuffled.map((q: { id: string }) => q.id));
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

      // Kick off round 1 immediately
      const { data: game } = await db
        .from("games")
        .select("id")
        .eq("room_id", s.data.roomId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (game) await beginRound(db, game.id, 1, settings.timer_seconds);
      return NextResponse.json({ ok: true, gameId: game?.id });
    }

    case "answer": {
      const a = answerSchema.safeParse({
        gameId: input.gameId,
        roundNumber: input.roundNumber,
        option: input.option ?? input.option,
      });
      if (!a.success) return NextResponse.json({ error: "Invalid answer" }, { status: 400 });

      // Anti-cheat: client submits the option's DISPLAY position (A-D of their
      // per-player shuffled view). Map it back to the real option letter using
      // the same deterministic shuffle the round API used.
      const { data: gqRow } = await db
        .from("game_questions")
        .select("id, question_id")
        .eq("game_id", a.data.gameId)
        .eq("round_number", a.data.roundNumber)
        .single();
      const { data: qRow } = await db
        .from("questions")
        .select("options")
        .eq("id", gqRow?.question_id ?? "")
        .single();
      if (!gqRow || !qRow) return NextResponse.json({ error: "Round not found" }, { status: 404 });

      const { data: playerRow } = await db
        .from("room_players")
        .select("id")
        .eq("id", playerId)
        .single();
      if (!playerRow) return NextResponse.json({ error: "Player not found" }, { status: 403 });

      const seedStr = `${playerId}:${gqRow.id}`;
      let h = 2166136261;
      for (let i = 0; i < seedStr.length; i++) {
        h ^= seedStr.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      const rand = () => {
        h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
        return ((h >>> 0) % 10000) / 10000;
      };
      const idx = [0, 1, 2, 3];
      for (let i = idx.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [idx[i], idx[j]] = [idx[j], idx[i]];
      }
      // Display position "A"=0, "B"=1... → original index → real option letter
      const realOption = ["A", "B", "C", "D"][idx["ABCD".indexOf(a.data.option as string)]];

      const result = await submitAnswer(
        db,
        a.data.gameId,
        a.data.roundNumber,
        playerId,
        realOption as PlayerOption
      );
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    case "closeRound": {
      // Any connected player can trigger close when deadline passed or all answered;
      // server re-validates closed state idempotently.
      if (!input.gameId || !input.roundNumber || !input.roomId)
        return NextResponse.json({ error: "Missing fields" }, { status: 400 });
      const { data: gq } = await db
        .from("game_questions")
        .select("id, deadline_at, closed_at, question_id")
        .eq("game_id", input.gameId)
        .eq("round_number", input.roundNumber)
        .single();
      if (!gq) return NextResponse.json({ error: "Round not found" }, { status: 404 });
      // Zero-answer rounds must still close when the deadline passes, otherwise
      // the game stalls forever (e.g. all players idle).
      const deadlinePassed = new Date(gq.deadline_at).getTime() <= Date.now();

      // SECURITY: use the game's STORED settings for scoring — never client input.
      const { data: gameSettings } = await db
        .from("games")
        .select(
          "game_mode, difficulty, categories, timer_seconds, total_rounds"
        )
        .eq("id", input.gameId)
        .single();
      if (!gameSettings) return NextResponse.json({ error: "Game not found" }, { status: 404 });
      const settings: GameSettings = {
        game_mode: gameSettings.game_mode,
        difficulty: gameSettings.difficulty,
        categories: gameSettings.categories,
        timer_seconds: gameSettings.timer_seconds,
        total_rounds: gameSettings.total_rounds,
        speed_bonus: true,
        streak_bonus: true,
        explanations: true,
      };

      // Compute streaks from previous rounds
      const streaks = await computeStreaks(db, input.gameId, input.roundNumber);
      const result = await closeRound(db, input.gameId, input.roundNumber, settings, streaks);
      if (!result.ok && result.error !== "Already closed")
        return NextResponse.json({ error: result.error }, { status: 400 });

      // Auto-advance: next round or finish
      if (input.roundNumber >= (gameSettings.total_rounds ?? 0)) {
        await finishGame(db, input.gameId, input.roomId);
      }
      return NextResponse.json({ ok: true });
    }

    case "beginRound": {
      if (!input.gameId || !input.roundNumber)
        return NextResponse.json({ error: "Missing fields" }, { status: 400 });
      const { data: game } = await db
        .from("games")
        .select("timer_seconds")
        .eq("id", input.gameId)
        .single();
      if (!game) return NextResponse.json({ error: "Game not found" }, { status: 404 });
      const result = await beginRound(db, input.gameId, input.roundNumber, game.timer_seconds);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    case "finish": {
      if (!input.gameId || !input.roomId)
        return NextResponse.json({ error: "Missing fields" }, { status: 400 });
      await finishGame(db, input.gameId, input.roomId);
      return NextResponse.json({ ok: true });
    }

    case "rematch": {
      if (!input.roomId) return NextResponse.json({ error: "Missing room" }, { status: 400 });
      const result = await rematch(db, input.roomId);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json({ ok: true });
    }
  }
}

async function computeStreaks(
  db: ReturnType<typeof serviceClient>,
  gameId: string,
  upToRound: number
): Promise<Record<string, number>> {
  const { data: gqs } = await db
    .from("game_questions")
    .select("id, round_number")
    .eq("game_id", gameId)
    .lt("round_number", upToRound);
  const streaks: Record<string, number> = {};
  if (!gqs) return streaks;
  const byRound = [...gqs].sort((a: { round_number: number }, b: { round_number: number }) => a.round_number - b.round_number);
  for (const gq of byRound) {
    const { data: answers } = await db
      .from("answers")
      .select("player_id, is_correct")
      .eq("game_question_id", gq.id);
    for (const a of answers ?? []) {
      if (a.is_correct) streaks[a.player_id] = (streaks[a.player_id] ?? 0) + 1;
      else streaks[a.player_id] = 0;
    }
  }
  return streaks;
}
