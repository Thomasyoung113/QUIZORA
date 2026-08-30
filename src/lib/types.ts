export type Difficulty = "easy" | "medium" | "hard" | "adaptive";
export type GameMode = "classic" | "speed" | "mixed";
export type PlayerOption = "A" | "B" | "C" | "D";

export type RoomStatus = "lobby" | "starting" | "in_game" | "finished" | "expired";
export type GameStatus = "pending" | "active" | "finished" | "cancelled";

export interface Profile {
  id: string;
  username: string;
  avatar_url: string | null;
  xp: number;
  total_games: number;
  total_wins: number;
  total_questions: number;
  correct_answers: number;
  best_streak: number;
}

export interface RoomPlayer {
  id: string;
  room_id: string;
  user_id: string | null;
  display_name: string;
  is_host: boolean;
  is_ready: boolean;
  connected: boolean;
}

export interface Room {
  id: string;
  room_code: string;
  host_id: string | null;
  status: RoomStatus;
  max_players: number;
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

export interface Game {
  id: string;
  room_id: string;
  game_mode: GameMode;
  difficulty: Difficulty;
  categories: string[];
  timer_seconds: number;
  total_rounds: number;
  current_round: number;
  status: GameStatus;
}

export interface PublicQuestion {
  id: string;
  question: string;
  category: string;
  subcategory: string | null;
  difficulty: Difficulty;
  options: string[];
}

export interface AnswerView {
  player_id: string;
  display_name: string;
  option: PlayerOption | null;
  is_correct: boolean | null;
  points: number;
  response_ms: number | null;
}

export interface RoundResults {
  correct_option: PlayerOption;
  explanation: string;
  answers: AnswerView[];
  scores: Record<string, number>;
}

export interface ScoreRow {
  player_id: string;
  display_name: string;
  score: number;
  streak: number;
}

export const CATEGORIES = [
  "Science",
  "Technology",
  "Geography",
  "History",
  "Nature",
  "Space",
  "Culture",
  "Business",
  "Logic",
  "General Knowledge",
] as const;

export const GAME_MODES: { value: GameMode; label: string }[] = [
  { value: "classic", label: "Classic" },
  { value: "speed", label: "Speed Round" },
  { value: "mixed", label: "Mixed Challenge" },
];

export const DIFFICULTIES: { value: Difficulty; label: string }[] = [
  { value: "easy", label: "Easy" },
  { value: "medium", label: "Medium" },
  { value: "hard", label: "Hard" },
  { value: "easy" as Difficulty, label: "Adaptive" }, // adaptive resolves server-side
];

export const TIMER_OPTIONS = [5, 10, 15, 30, 60];
export const ROUND_OPTIONS = [5, 10, 15, 20];

export const POINTS_CORRECT = 100;
export const SPEED_BONUS_MAX = 50;
export const STREAK_BONUS_STEP = 25;
export const STREAK_BONUS_CAP = 100;
