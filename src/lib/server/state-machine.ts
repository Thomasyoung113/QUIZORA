import type { PlayerOption } from "../types";
import { computePoints, serviceClient } from "./game";
import type { GameSettings } from "../types";

type DB = ReturnType<typeof serviceClient>;

export type GameState =
  | "lobby"
  | "starting"
  | "question"
  | "reveal"
  | "finished";

export interface TransitionResult {
  ok: boolean;
  error?: string;
}

/**
 * Explicit state-machine transitions. All writes go through here so
 * invalid transitions are rejected server-side.
 *
 * LOBBY -> STARTING -> QUESTION <-> REVEAL -> FINISHED
 */

export async function startGame(
  db: DB,
  roomId: string,
  requesterPlayerId: string,
  settings: GameSettings,
  questionIds: string[]
): Promise<TransitionResult> {
  const { data: room } = await db
    .from("rooms")
    .select("id, status, host_id")
    .eq("id", roomId)
    .single();
  if (!room) return { ok: false, error: "Room not found" };
  if (room.status !== "lobby")
    return { ok: false, error: "Game already started" };

  const { data: host } = await db
    .from("room_players")
    .select("id, is_host, is_ready")
    .eq("id", requesterPlayerId)
    .eq("room_id", roomId)
    .single();
  if (!host || !host.is_host) return { ok: false, error: "Only the host can start" };

  const { data: players } = await db
    .from("room_players")
    .select("id, connected, is_ready")
    .eq("room_id", roomId);
  const active = (players ?? []).filter(
    (p: { connected: boolean }) => p.connected
  );
  if (active.length < 1) return { ok: false, error: "No players" };
  if (active.some((p: { is_ready: boolean }) => !p.is_ready))
    return { ok: false, error: "Not all players are ready" };

  const { data: game, error: gErr } = await db
    .from("games")
    .insert({
      room_id: roomId,
      game_mode: settings.game_mode,
      difficulty: settings.difficulty,
      categories: settings.categories,
      timer_seconds: settings.timer_seconds,
      total_rounds: settings.total_rounds,
      current_round: 0,
      status: "active",
    })
    .select("id")
    .single();
  if (gErr) return { ok: false, error: "Could not create game" };

  // Pre-select all questions for the game up front (unused-in-game uniqueness).
  for (let i = 0; i < questionIds.length; i++) {
    await db.from("game_questions").insert({
      game_id: game.id,
      round_number: i + 1,
      question_id: questionIds[i],
    });
  }

  await db.from("rooms").update({ status: "in_game" }).eq("id", roomId);
  return { ok: true };
}

export async function beginRound(
  db: DB,
  gameId: string,
  roundNumber: number,
  timerSeconds: number
): Promise<TransitionResult> {
  const { data: game } = await db
    .from("games")
    .select("id, status, total_rounds, current_round")
    .eq("id", gameId)
    .single();
  if (!game || game.status !== "active")
    return { ok: false, error: "Game not active" };
  if (roundNumber !== game.current_round + 1)
    return { ok: false, error: "Invalid round sequence" };

  const deadline = new Date(Date.now() + timerSeconds * 1000);
  const { error } = await db
    .from("game_questions")
    .update({ started_at: new Date().toISOString(), deadline_at: deadline.toISOString() })
    .eq("game_id", gameId)
    .eq("round_number", roundNumber);
  if (error) return { ok: false, error: "Could not start round" };

  await db
    .from("games")
    .update({ current_round: roundNumber })
    .eq("id", gameId);
  return { ok: true };
}

export async function submitAnswer(
  db: DB,
  gameId: string,
  roundNumber: number,
  playerId: string,
  option: PlayerOption
): Promise<TransitionResult> {
  const { data: gq } = await db
    .from("game_questions")
    .select("id, started_at, deadline_at, closed_at")
    .eq("game_id", gameId)
    .eq("round_number", roundNumber)
    .single();
  if (!gq || !gq.started_at || !gq.deadline_at)
    return { ok: false, error: "Round not active" };
  if (gq.closed_at) return { ok: false, error: "Round already closed" };

  const now = Date.now();
  const deadline = new Date(gq.deadline_at).getTime();
  if (now > deadline + 500) return { ok: false, error: "Too late" }; // 500ms grace

  const responseMs = now - new Date(gq.started_at).getTime();

  // SECURITY: sub-300ms responses are bot-speed; reject as suspicious.
  if (responseMs < 300) return { ok: false, error: "Too fast" };

  // SECURITY: insert-only. The DB unique constraint (game_question_id, player_id)
  // rejects a second answer — no answer rewriting after the fact.
  const { error } = await db.from("answers").insert({
    game_question_id: gq.id,
    player_id: playerId,
    option,
    submitted_at: new Date().toISOString(),
    response_ms: responseMs,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Already answered" };
    return { ok: false, error: "Could not submit" };
  }
  return { ok: true };
}

export async function closeRound(
  db: DB,
  gameId: string,
  roundNumber: number,
  settings: GameSettings,
  streaks: Record<string, number>
): Promise<TransitionResult> {
  const { data: gq } = await db
    .from("game_questions")
    .select("id, closed_at")
    .eq("game_id", gameId)
    .eq("round_number", roundNumber)
    .single();
  if (!gq) return { ok: false, error: "Round not found" };
  if (gq.closed_at) return { ok: false, error: "Already closed" };

  const { data: question } = await db
    .from("questions")
    .select("correct_option")
    .eq(
      "id",
      (
        await db
          .from("game_questions")
          .select("question_id")
          .eq("game_id", gameId)
          .eq("round_number", roundNumber)
          .single()
      ).data?.question_id
    )
    .single();
  if (!question) return { ok: false, error: "Question missing" };

  const { data: answers } = await db
    .from("answers")
    .select("id, player_id, option, response_ms")
    .eq("game_question_id", gq.id);

  for (const a of answers ?? []) {
    const correct = a.option === question.correct_option;
    const streak = correct ? (streaks[a.player_id] ?? 0) + 1 : 0;
    const points = computePoints(correct, a.response_ms, settings.timer_seconds * 1000, streak, settings);
    await db
      .from("answers")
      .update({ is_correct: correct, points })
      .eq("id", a.id);
  }

  await db
    .from("game_questions")
    .update({ closed_at: new Date().toISOString() })
    .eq("id", gq.id);
  return { ok: true };
}

export async function finishGame(db: DB, gameId: string, roomId: string): Promise<TransitionResult> {
  await db.from("games").update({ status: "finished", ended_at: new Date().toISOString() }).eq("id", gameId);
  await db.from("rooms").update({ status: "finished", ended_at: new Date().toISOString() }).eq("id", roomId);
  return { ok: true };
}

export async function rematch(db: DB, roomId: string): Promise<TransitionResult> {
  const { data: room } = await db
    .from("rooms")
    .select("id, status")
    .eq("id", roomId)
    .single();
  if (!room) return { ok: false, error: "Room not found" };
  if (room.status !== "finished") return { ok: false, error: "Game not finished" };
  await db
    .from("room_players")
    .update({ is_ready: false })
    .eq("room_id", roomId)
    .neq("is_host", true);
  await db.from("rooms").update({ status: "lobby", ended_at: null }).eq("id", roomId);
  return { ok: true };
}
