import { createHash, randomBytes, randomUUID } from "crypto";
import { createClient } from "@supabase/supabase-js";
import type { GameSettings, PlayerOption, RoomPlayer } from "../types";
import {
  POINTS_CORRECT,
  SPEED_BONUS_MAX,
  STREAK_BONUS_CAP,
  STREAK_BONUS_STEP,
} from "../types";

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

export function generateRoomCode(length = 6): string {
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i++) {
    code += ROOM_CODE_ALPHABET[bytes[i] % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newGuestToken(): { token: string; hash: string } {
  const token = randomBytes(24).toString("base64url");
  return { token, hash: hashToken(token) };
}

export function serviceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase service credentials");
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function createRoomWithCode(
  db: ReturnType<typeof serviceClient>,
  hostName: string,
  hostUserId: string | null,
  guestHash: string | null
): Promise<{ room: { id: string; room_code: string }; player: RoomPlayer }> {
  // Retry on code collision
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    const { data: room, error: roomErr } = await db
      .from("rooms")
      .insert({ room_code: code, host_id: hostUserId, status: "lobby" })
      .select("id, room_code")
      .single();
    if (roomErr) continue; // unique violation -> retry
    const { data: player, error: pErr } = await db
      .from("room_players")
      .insert({
        room_id: room.id,
        user_id: hostUserId,
        guest_token_hash: guestHash,
        display_name: hostName,
        is_host: true,
        is_ready: true,
        connected: true,
      })
      .select()
      .single();
    if (pErr) throw pErr;
    return { room, player: player as RoomPlayer };
  }
  throw new Error("Could not allocate unique room code");
}

export interface JoinResult {
  ok: boolean;
  error?: string;
  playerId?: string;
}

export async function joinRoom(
  db: ReturnType<typeof serviceClient>,
  roomId: string,
  displayName: string,
  userId: string | null,
  guestHash: string | null
): Promise<JoinResult> {
  const { data: room } = await db
    .from("rooms")
    .select("id, status, max_players")
    .eq("id", roomId)
    .single();
  if (!room) return { ok: false, error: "Room not found" };
  if (room.status !== "lobby") return { ok: false, error: "Game already started" };

  const { data: players } = await db
    .from("room_players")
    .select("id, user_id, guest_token_hash, connected, left_at")
    .eq("room_id", roomId);

  const active = (players ?? []).filter((p: { connected: boolean; left_at: string | null }) => p.connected && !p.left_at);
  if (active.length >= room.max_players) return { ok: false, error: "Room is full" };

  // Rejoin path: match on guest hash or user id
  const mine = (players ?? []).find(
    (p: { id: string; user_id: string | null; guest_token_hash: string | null }) =>
      (userId && p.user_id === userId) || p.guest_token_hash === guestHash
  );
  if (mine) {
    await db
      .from("room_players")
      .update({ connected: true, left_at: null, display_name: displayName })
      .eq("id", mine.id);
    return { ok: true, playerId: mine.id };
  }

  const { data: created, error } = await db
    .from("room_players")
    .insert({
      room_id: roomId,
      user_id: userId,
      guest_token_hash: guestHash,
      display_name: displayName,
      is_host: false,
      is_ready: false,
      connected: true,
    })
    .select("id")
    .single();
  if (error) return { ok: false, error: "Join failed" };
  return { ok: true, playerId: created.id };
}

// ---- Scoring ----

export function computePoints(
  isCorrect: boolean,
  responseMs: number | null,
  deadlineMs: number,
  streak: number,
  settings: Pick<GameSettings, "game_mode" | "speed_bonus" | "streak_bonus">
): number {
  if (!isCorrect) return 0;
  let points = POINTS_CORRECT;
  if (settings.speed_bonus && responseMs != null && deadlineMs > 0) {
    const remaining = Math.max(0, deadlineMs - responseMs);
    const ratio = Math.min(1, remaining / deadlineMs);
    const bonus =
      settings.game_mode === "speed" ? SPEED_BONUS_MAX : Math.round(SPEED_BONUS_MAX * ratio);
    points += bonus;
  }
  if (settings.streak_bonus && streak >= 2) {
    points += Math.min(STREAK_BONUS_CAP, (streak - 1) * STREAK_BONUS_STEP);
  }
  return points;
}

export function isCorrectAnswer(
  submitted: PlayerOption,
  correct: PlayerOption
): boolean {
  return submitted === correct;
}

export function newGameId(): string {
  return randomUUID();
}
