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
      if (res.status === 410) {
        // Room closed (grace elapsed): signal caller to redirect home.
        setState(null);
        setError("ROOM_CLOSED");
        return;
      }
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
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    let fallbackTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    function startPolling() {
      if (pollTimer || disposed) return;
      // Fallback: poll like before (also used when SSE is unavailable).
      pollTimer = setInterval(() => {
        if (activeRef.current && document.visibilityState !== "hidden") refresh();
      }, intervalMs);
    }

    // Primary: SSE push stream (auto-reconnect handled by EventSource).
    if (typeof EventSource !== "undefined") {
      es = new EventSource(`/api/stream?code=${encodeURIComponent(code)}`);
      es.addEventListener("state", (ev) => {
        try {
          setState(JSON.parse((ev as MessageEvent).data));
          setError(null);
        } catch {
          // malformed event: ignore, next event corrects
        }
      });
      es.addEventListener("closed", () => {
        setState(null);
        setError("ROOM_CLOSED");
        es?.close();
      });
      es.addEventListener("round", () => {
        // Round started/closed: nudge the round hook to refetch instantly.
        window.dispatchEvent(new Event("quizora:round-event"));
      });
      es.addEventListener("gone", () => {
        setState(null);
        setError("ROOM_CLOSED");
        es?.close();
      });
      es.onerror = () => {
        // EventSource retries on its own; also poll as a belt-and-braces
        // fallback while the connection is down.
        startPolling();
      };
      // If SSE connects cleanly, stop the fallback poller.
      es.onopen = () => {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
      };
    } else {
      startPolling();
    }

    // Defer initial fetch past mount to avoid cascading-render lint error.
    const init = setTimeout(() => refresh(), 0);
    fallbackTimer = setTimeout(() => {
      // If no SSE state arrived within 5s, make sure polling is running.
      startPolling();
    }, 5000);

    return () => {
      disposed = true;
      activeRef.current = false;
      clearTimeout(init);
      if (fallbackTimer) clearTimeout(fallbackTimer);
      if (pollTimer) clearInterval(pollTimer);
      es?.close();
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

  // Listen for room-level SSE `round` events (started/closed) and refresh
  // the round view immediately. Falls back to light polling.
  useEffect(() => {
    if (!gameId || !round) return;
    const onRound = () => {
      refresh();
    };
    window.addEventListener("quizora:round-event", onRound);
    const init = setTimeout(() => refresh(), 0);
    const t = setInterval(() => {
      if (document.visibilityState !== "hidden") refresh();
    }, intervalMs);
    return () => {
      window.removeEventListener("quizora:round-event", onRound);
      clearTimeout(init);
      clearInterval(t);
    };
  }, [gameId, round, refresh, intervalMs]);

  return { roundState, refresh };
}
