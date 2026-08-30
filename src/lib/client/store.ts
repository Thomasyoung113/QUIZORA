"use client";

import { useEffect, useRef, useState, useCallback } from "react";

export interface RoomStateView {
  room: { id: string; room_code: string; status: string; max_players: number };
  players: {
    id: string;
    display_name: string;
    is_host: boolean;
    is_ready: boolean;
    connected: boolean;
  }[];
  game: {
    id: string;
    game_mode: string;
    difficulty: string;
    categories: string[];
    timer_seconds: number;
    total_rounds: number;
    current_round: number;
    status: string;
  } | null;
  scores: Record<string, number>;
}

/**
 * Polling-based realtime (works reliably on mobile networks without websocket config).
 * Polls room state; question state is polled only during an active round.
 */
export function useRoomState(code: string, intervalMs = 1500) {
  const [state, setState] = useState<RoomStateView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const activeRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/room-state?code=${code}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "Failed");
      const data = await res.json();
      setState(data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Connection lost");
    }
  }, [code]);

  useEffect(() => {
    if (!code) return;
    activeRef.current = true;
    refresh();
    const t = setInterval(() => {
      if (activeRef.current && document.visibilityState !== "hidden") refresh();
    }, intervalMs);
    return () => {
      activeRef.current = false;
      clearInterval(t);
    };
  }, [code, refresh, intervalMs]);

  return { state, error, refresh };
}

export interface RoundView {
  roundNumber: number;
  startedAt: string | null;
  deadlineAt: string | null;
  closedAt: string | null;
  answerCount: number;
  question: {
    id: string;
    question: string;
    category: string;
    subcategory: string | null;
    difficulty: string;
    options: string[];
  } | null;
  revealed: boolean;
  correctOption?: string;
  explanation?: string;
  answers?: {
    player_id: string;
    option: string | null;
    is_correct: boolean | null;
    points: number | null;
    display_name: string;
  }[];
}

export function useRound(gameId: string | null | undefined, round: number | null | undefined, intervalMs = 1000) {
  const [roundState, setRoundState] = useState<RoundView | null>(null);

  const refresh = useCallback(async () => {
    if (!gameId || !round) return;
    const res = await fetch(`/api/round?gameId=${gameId}&round=${round}`, { cache: "no-store" });
    if (res.ok) setRoundState(await res.json());
  }, [gameId, round]);

  useEffect(() => {
    if (!gameId || !round) return;
    refresh();
    const t = setInterval(() => {
      if (document.visibilityState !== "hidden") refresh();
    }, intervalMs);
    return () => clearInterval(t);
  }, [gameId, round, refresh, intervalMs]);

  return { roundState, refresh };
}
