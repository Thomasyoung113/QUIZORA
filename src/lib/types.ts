export type Difficulty = "easy" | "medium" | "hard" | "adaptive";
export type GameMode = "classic" | "speed" | "mixed";
export type PlayerOption = "A" | "B" | "C" | "D";

export type RoomStatus = "lobby" | "starting" | "in_game" | "finished" | "expired";
export type GameStatus = "pending" | "active" | "finished" | "cancelled";

export interface RoomPlayer {
  id: string;
  room_id: string;
  user_id: string | null;
  display_name: string;
  is_host: boolean;
  is_ready: boolean;
  connected: boolean;
}

export interface GameSettings {
  game_mode: GameMode;
  difficulty: Difficulty;
  categories: string[];
  timer_seconds: number;
  total_rounds: number;
  speed_bonus: boolean;
  streak_bonus: boolean;
  explanations: boolean;
}

export const POINTS_CORRECT = 100;
export const SPEED_BONUS_MAX = 50;
export const STREAK_BONUS_STEP = 25;
export const STREAK_BONUS_CAP = 100;
