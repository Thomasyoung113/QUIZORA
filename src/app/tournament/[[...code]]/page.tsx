"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

type Entry = { id: string; user_id: string; display_name: string; seed: number | null; eliminated_in: number | null };
type Match = {
  id: string;
  bracket_round: number;
  match_slot: number;
  room_id: string | null;
  player_a_id: string | null;
  player_b_id: string | null;
  winner_entry_id: string | null;
  status: string;
  room: { room_code: string; status: string } | null;
};
type State = {
  tournament: { id: string; code: string; host_id: string; status: string; size: number; champion_user_id: string | null };
  entries: Entry[];
  matches: Match[];
};

const ROUND_NAMES = ["Semifinals", "Final"];

export default function TournamentPage() {
  const params = useParams<{ code?: string }>();
  const router = useRouter();
  const urlCode = params?.code;
  const [state, setState] = useState<State | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [myUserId, setMyUserId] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const tournamentIdRef = useRef<string | null>(null);

  // Who am I? (session check)
  useEffect(() => {
    fetch("/api/me").then(async (r) => {
      if (r.ok) {
        const d = await r.json();
        setMyUserId(d.user?.id ?? null);
      }
    }).catch(() => {});
  }, []);

  // If URL has a tournament code, resolve to state
  useEffect(() => {
    if (!urlCode) return;
    (async () => {
      const res = await fetch("/api/tournament", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join", code: urlCode }),
      });
      const d = await res.json().catch(() => ({}));
      if (d.tournamentId) tournamentIdRef.current = d.tournamentId;
      else if (res.status === 400 && d.error === "Tournament already started") {
        // Already running; we need the id — join returns 400 without id, so try lookup via code->id
        // State endpoint needs an id; simplest: re-join is idempotent in lobby, but started tournaments
        // need the id. We handle this by keeping the join-when-lobby then falling back to error.
      } else if (!res.ok) setError(d.error ?? "Not found");
    })();
  }, [urlCode]);

  const loadState = useCallback(async () => {
    const id = tournamentIdRef.current;
    if (!id) return;
    const res = await fetch("/api/tournament", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "state", tournamentId: id }),
    });
    if (res.ok) {
      const d = await res.json();
      setState(d);
    }
  }, []);

  // Poll state while we have a tournament
  useEffect(() => {
    if (!tournamentIdRef.current) return;
    loadState();
    pollRef.current = setInterval(loadState, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadState, state?.tournament?.status]);

  async function createTournament(size: number) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tournament", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create", size, difficulty: "medium", categories: ["General Knowledge", "Science", "History"], timer_seconds: 15, rounds_per_match: 5 }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed");
      tournamentIdRef.current = d.tournamentId;
      await loadState();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
    setBusy(false);
  }

  async function joinByCode() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/tournament", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "join", code: joinCode.trim().toUpperCase() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed");
      tournamentIdRef.current = d.tournamentId;
      await loadState();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
    }
    setBusy(false);
  }

  async function startTournament() {
    setBusy(true);
    try {
      const res = await fetch("/api/tournament", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", tournamentId: tournamentIdRef.current }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error ?? "Start failed");
      }
      await loadState();
    } finally {
      setBusy(false);
    }
  }

  function entryName(id: string | null): string {
    if (!id) return "—";
    return state?.entries.find((e) => e.id === id)?.display_name ?? "?";
  }

  function myMatch(): Match | null {
    if (!state || !myUserId) return null;
    return state.matches.find(
      (m) => m.status === "active" && [m.player_a_id, m.player_b_id].some((pid) => {
        const e = state.entries.find((x) => x.id === pid);
        return e?.user_id === myUserId;
      })
    ) ?? null;
  }

  function entryUserId(id: string | null): string | null {
    return state?.entries.find((e) => e.id === id)?.user_id ?? null;
  }

  const m = myMatch();

  // Auto-advance: after each match game finishes, any participant can ping advance.
  useEffect(() => {
    if (!state) return;
    const t = state.tournament;
    if (t.status !== "running") return;
    const finishedMatches = state.matches.filter((x) => x.status === "active" && x.room?.status === "finished");
    for (const fm of finishedMatches) {
      fetch("/api/tournament", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "advance", tournamentId: t.id, matchId: fm.id }),
      }).then(() => loadState()).catch(() => {});
    }
  }, [state, loadState]);

  if (!state) {
    return (
      <main className="min-h-dvh  flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-6">
          <h1 className="text-3xl font-black text-center">Tournament</h1>
          <div className="flex gap-2">
            {[4, 8].map((n) => (
              <button key={n} onClick={() => createTournament(n)} disabled={busy}
                className="flex-1 rounded-xl bg-lime hover:bg-[#d6fa5c] active:scale-[0.98] disabled:opacity-50 text-ink font-bold py-3 transition">
                {busy ? "…" : `${n} players`}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 text-paper/40 text-xs">
            <div className="h-px flex-1 bg-paper/10" />OR JOIN<div className="h-px flex-1 bg-paper/10" />
          </div>
          <input value={joinCode} onChange={(e) => setJoinCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
            placeholder="TOURNAMENT CODE" inputMode="text" autoCapitalize="characters"
            className="w-full rounded-xl bg-paper/10 border border-paper/20 px-4 py-3 text-center text-lg tracking-widest outline-none focus:border-lime/60 placeholder:text-paper/40" />
          <button onClick={joinByCode} disabled={busy || joinCode.length !== 6}
            className="w-full rounded-xl bg-paper/10 hover:bg-white/15 active:scale-[0.98] disabled:opacity-40 border border-paper/20 font-bold py-3 transition">
            Join Tournament
          </button>
          {error && <p className="text-coral text-sm text-center">⚠ {error}</p>}
          <p className="text-paper/40 text-xs text-center">Login required — no guests in tournaments.</p>
        </div>
      </main>
    );
  }

  const t = state.tournament;
  const isHost = myUserId === t.host_id;
  const champion = t.champion_user_id ? state.entries.find((e) => e.user_id === t.champion_user_id) : null;
  const rounds = [...new Set(state.matches.map((x) => x.bracket_round))].sort();

  return (
    <main className="min-h-dvh  p-4">
      <div className="max-w-md mx-auto space-y-5 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-black">{t.size}P Tournament</h1>
          <button onClick={() => { navigator.clipboard?.writeText(`${location.origin}/tournament/${t.code}`).catch(() => {}); }}
            className="rounded-lg bg-paper/10 border border-paper/20 px-3 py-1.5 text-sm font-mono tracking-widest active:scale-95">
            {t.code} ⧉
          </button>
        </div>

        {champion && (
          <div className="rounded-2xl bg-lime/10 border border-lime/40 p-4 text-center">
            <p className="text-lime text-xs uppercase tracking-wider">Champion</p>
            <p className="text-2xl font-black text-amber-200">{champion.display_name}</p>
          </div>
        )}

        {t.status === "lobby" && (
          <div className="rounded-2xl bg-paper/5 border border-paper/15 p-4 space-y-3">
            <p className="text-sm text-paper/75">{state.entries.length}/{t.size} joined</p>
            <div className="flex flex-wrap gap-2">
              {state.entries.map((e) => (
                <span key={e.id} className="rounded-full bg-paper/10 px-3 py-1 text-sm">{e.display_name}</span>
              ))}
            </div>
            {isHost && (
              <button onClick={startTournament} disabled={busy || state.entries.length !== t.size}
                className="w-full rounded-xl bg-lime disabled:opacity-40 text-ink font-bold py-3">
                {state.entries.length === t.size ? "Start Tournament" : `Waiting for ${t.size - state.entries.length} more…`}
              </button>
            )}
          </div>
        )}

        {m && (
          <div className="rounded-2xl bg-mint/10 border border-mint/40 p-4 space-y-3">
            <p className="text-mint text-xs uppercase tracking-wider">Your match — {ROUND_NAMES[m.bracket_round - 1] ?? `Round ${m.bracket_round}`}</p>
            <div className="flex items-center justify-between text-sm">
              <span className={entryUserId(m.player_a_id) === myUserId ? "font-black text-mint" : ""}>{entryName(m.player_a_id)}</span>
              <span className="text-paper/40">vs</span>
              <span className={entryUserId(m.player_b_id) === myUserId ? "font-black text-mint" : ""}>{entryName(m.player_b_id)}</span>
            </div>
            {m.room && (
              <button onClick={() => router.push(`/${m.room!.room_code}`)}
                className="w-full rounded-xl bg-mint text-ink font-bold py-3 active:scale-[0.98]">
                {m.room.status === "lobby" ? "Enter Match Room" : "Back to Match"}
              </button>
            )}
          </div>
        )}

        {rounds.map((r) => (
          <div key={r} className="space-y-2">
            <p className="text-xs uppercase tracking-wider text-paper/50">{ROUND_NAMES[r - 1] ?? `Round ${r}`}</p>
            {state.matches.filter((x) => x.bracket_round === r).map((x) => (
              <div key={x.id} className="rounded-xl bg-paper/5 border border-paper/15 px-4 py-3 flex items-center justify-between text-sm">
                <span className={x.winner_entry_id === x.player_a_id ? "font-bold text-mint" : x.winner_entry_id ? "text-paper/40 line-through" : ""}>
                  {entryName(x.player_a_id)}
                </span>
                <span className="text-paper/30 text-xs">vs</span>
                <span className={x.winner_entry_id === x.player_b_id ? "font-bold text-mint text-right" : x.winner_entry_id ? "text-paper/40 line-through text-right" : "text-right"}>
                  {entryName(x.player_b_id)}
                </span>
              </div>
            ))}
          </div>
        ))}

        {t.status === "running" && !m && (
          <p className="text-paper/40 text-sm text-center">Waiting for other matches to finish…</p>
        )}

        <button onClick={() => { tournamentIdRef.current = null; setState(null); }}
          className="w-full text-paper/40 text-xs py-2">New / join another</button>
      </div>
    </main>
  );
}
