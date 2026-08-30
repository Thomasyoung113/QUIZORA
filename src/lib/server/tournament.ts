import { randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type Db = SupabaseClient<any, "public", "public", any, any>;

type TournamentRow = {
  id: string;
  size: number;
  difficulty: string;
  categories: string[];
  timer_seconds: number;
  rounds_per_match: number;
};

type EntryRow = { id: string; user_id: string; display_name: string };

export type AdvanceResult =
  | { ok: true; advanced: boolean; tournamentFinished: boolean }
  | { ok: false; error: string };

/** Power-of-two bracket seeding: 1v8, 4v5, 3v6, 2v7 style for 8; 1v4, 2v3 for 4. */
function seedPairings(size: number): Array<[number, number]> {
  // Standard bracket order for sizes 4/8/16
  const orders: Record<number, number[]> = {
    4: [1, 4, 2, 3],
    8: [1, 8, 4, 5, 3, 6, 2, 7],
    16: [1, 16, 8, 9, 4, 13, 5, 12, 3, 14, 6, 11, 2, 15, 7, 10],
  };
  const order = orders[size];
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < order.length; i += 2) pairs.push([order[i], order[i + 1]]);
  return pairs;
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Seed round 1: assign random seeds to entries, create match rows + one room
 * per match (rooms in 'lobby' so each pair can ready up and start).
 */
export async function seedBracket(
  db: Db,
  t: TournamentRow
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: entries } = await db
    .from("tournament_entries")
    .select("id, user_id, display_name")
    .eq("tournament_id", t.id);
  if (!entries || entries.length !== t.size) return { ok: false, error: "Wrong player count" };

  const shuffled = shuffle(entries as EntryRow[]);
  // Assign seeds
  for (let i = 0; i < shuffled.length; i++) {
    await db.from("tournament_entries").update({ seed: i + 1 }).eq("id", shuffled[i].id);
  }
  const bySeed = shuffled; // index i = seed i+1

  await db.from("tournaments").update({ status: "seeding" }).eq("id", t.id);

  const pairs = seedPairings(t.size);
  for (let slot = 0; slot < pairs.length; slot++) {
    const [seedA, seedB] = pairs[slot];
    const a = bySeed[seedA - 1];
    const b = bySeed[seedB - 1];

    // One room per match; host is player A's user.
    const code = await createMatchRoom(db, a.user_id);
    if (!code) return { ok: false, error: "Could not create match room" };
    const { data: room } = await db.from("rooms").select("id").eq("room_code", code).single();
    if (!room) return { ok: false, error: "Match room missing" };

    // Add both players to the room (host + guest-style rows tied to users)
    await db.from("room_players").insert([
      { room_id: room.id, user_id: a.user_id, display_name: a.display_name, is_host: true, is_ready: true },
      { room_id: room.id, user_id: b.user_id, display_name: b.display_name, is_host: false, is_ready: false },
    ]);

    const { error } = await db.from("tournament_matches").insert({
      tournament_id: t.id,
      bracket_round: 1,
      match_slot: slot + 1,
      room_id: room.id,
      player_a_id: a.id,
      player_b_id: b.id,
      status: "active",
    });
    if (error) return { ok: false, error: "Could not create match" };
  }

  await db.from("tournaments").update({ status: "running", started_at: new Date().toISOString() }).eq("id", t.id);
  return { ok: true };
}

async function createMatchRoom(db: Db, hostUserId: string): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: alphabet } = { data: null, error: null } as never;
    void alphabet;
    const code = generateCode();
    const { data, error } = await db
      .from("rooms")
      .insert({ room_code: code, host_id: hostUserId, status: "lobby", max_players: 2 })
      .select("room_code")
      .single();
    if (!error && data) return data.room_code;
  }
  return null;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function generateCode(): string {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

/**
 * Called after a match's game finishes (client hits /api/tournament/advance
 * with the match id, or finishGame hook). Checks the match result, records
 * the winner, and when all matches in the round are done, seeds the next
 * round or crowns the champion.
 */
export async function tryAdvance(db: Db, tournamentId: string, matchId: string): Promise<AdvanceResult> {
  const { data: match } = await db
    .from("tournament_matches")
    .select("id, bracket_round, match_slot, game_id, room_id, player_a_id, player_b_id, winner_entry_id, status")
    .eq("id", matchId)
    .eq("tournament_id", tournamentId)
    .single();
  if (!match) return { ok: false, error: "Match not found" };
  if (match.status === "finished" || match.winner_entry_id) return { ok: true, advanced: false, tournamentFinished: false };

  // Score = sum of points across the game's answers per entry user
  const winnerId = await computeWinner(db, match);
  if (!winnerId) return { ok: true, advanced: false, tournamentFinished: false }; // game not finished yet

  await db.from("tournament_matches").update({ winner_entry_id: winnerId, status: "finished", finished_at: new Date().toISOString() }).eq("id", matchId);
  const loserId = winnerId === match.player_a_id ? match.player_b_id : match.player_a_id;
  if (loserId) await db.from("tournament_entries").update({ eliminated_in: match.bracket_round }).eq("id", loserId);

  // Are all matches in this round finished?
  const { data: roundMatches } = await db
    .from("tournament_matches")
    .select("id, winner_entry_id, bracket_round")
    .eq("tournament_id", tournamentId)
    .eq("bracket_round", match.bracket_round);
  if (!roundMatches?.length) return { ok: true, advanced: false, tournamentFinished: false };
  const allDone = roundMatches.every((m: { winner_entry_id: string | null }) => m.winner_entry_id);
  if (!allDone) return { ok: true, advanced: true, tournamentFinished: false };

  // Round complete: final round? crown champion. Otherwise seed next round.
  const { data: t } = await db
    .from("tournaments")
    .select("id, size")
    .eq("id", tournamentId)
    .single();
  if (!t) return { ok: false, error: "Tournament missing" };

  const winners = roundMatches.map((m: { winner_entry_id: string }) => m.winner_entry_id);
  if (winners.length === 1) {
    const { data: champ } = await db.from("tournament_entries").select("user_id").eq("id", winners[0]).single();
    await db
      .from("tournaments")
      .update({ status: "finished", champion_user_id: champ?.user_id ?? null, finished_at: new Date().toISOString() })
      .eq("id", tournamentId);
    return { ok: true, advanced: true, tournamentFinished: true };
  }

  // Seed next round with winners (sequential slots, random order preserved by match_slot)
  for (let slot = 0; slot * 2 < winners.length; slot++) {
    const aId = winners[slot * 2];
    const bId = winners[slot * 2 + 1];
    if (!bId) break;
    const { data: a } = await db.from("tournament_entries").select("id, user_id, display_name").eq("id", aId).single();
    const { data: b } = await db.from("tournament_entries").select("id, user_id, display_name").eq("id", bId).single();
    if (!a || !b) return { ok: false, error: "Winner entries missing" };

    const code = await createMatchRoom(db, a.user_id);
    if (!code) return { ok: false, error: "Could not create next-round room" };
    const { data: room } = await db.from("rooms").select("id").eq("room_code", code).single();
    if (!room) return { ok: false, error: "Next room missing" };

    await db.from("room_players").insert([
      { room_id: room.id, user_id: a.user_id, display_name: a.display_name, is_host: true, is_ready: true },
      { room_id: room.id, user_id: b.user_id, display_name: b.display_name, is_host: false, is_ready: false },
    ]);
    await db.from("tournament_matches").insert({
      tournament_id: tournamentId,
      bracket_round: match.bracket_round + 1,
      match_slot: slot + 1,
      room_id: room.id,
      player_a_id: a.id,
      player_b_id: b.id,
      status: "active",
    });
  }
  return { ok: true, advanced: true, tournamentFinished: false };
}

/** Winner = higher total points in the match game; null if game not finished. */
async function computeWinner(db: Db, match: { game_id: string | null; room_id: string | null; player_a_id: string; player_b_id: string }): Promise<string | null> {
  if (!match.room_id) return null;
  const { data: game } = await db.from("games").select("id, status").eq("room_id", match.room_id).single();
  if (!game || game.status !== "finished") return null;
  match.game_id = game.id;
  await db.from("tournament_matches").update({ game_id: game.id }).eq("room_id", match.room_id).eq("status", "active");

  const { data: rps } = await db.from("room_players").select("id, user_id").eq("room_id", match.room_id);
  if (!rps || rps.length !== 2) return null;
  const totals: Record<string, number> = {};
  for (const rp of rps) {
    const { data: answers } = await db
      .from("answers")
      .select("points")
      .eq("player_id", rp.id);
    totals[rp.user_id] = (answers ?? []).reduce((sum: number, a: { points: number | null }) => sum + (a.points ?? 0), 0);
  }
  const [rpA, rpB] = rps;
  const entryByUser: Record<string, string> = {};
  const { data: pa } = await db.from("tournament_entries").select("id, user_id").eq("id", match.player_a_id).single();
  const { data: pb } = await db.from("tournament_entries").select("id, user_id").eq("id", match.player_b_id).single();
  if (pa) entryByUser[pa.user_id] = pa.id;
  if (pb) entryByUser[pb.user_id] = pb.id;

  const ptsA = totals[rpA.user_id] ?? 0;
  const ptsB = totals[rpB.user_id] ?? 0;
  if (ptsA === ptsB) {
    // Tie: host (player A) advances — deterministic, documented.
    return entryByUser[rpA.user_id] ?? null;
  }
  const winnerUserId = ptsA > ptsB ? rpA.user_id : rpB.user_id;
  return entryByUser[winnerUserId] ?? null;
}

export function newMatchId(): string {
  return randomUUID();
}
