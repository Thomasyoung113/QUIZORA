"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useRoomState, useRound } from "@/lib/client/store";
import { useAntiCheat } from "@/lib/client/anticheat";
import JoinGate from "@/components/join-gate";

const OPTION_LABELS = ["A", "B", "C", "D"];

export default function RoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const code = (params.code as string)?.toUpperCase();
  const { state, error, refresh } = useRoomState(code);
  const [myPid, setMyPid] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setMyPid(d?.playerId ?? null))
      .catch(() => {});
  }, []);

  const game = state?.game ?? null;
  const inGame = game && (game.status === "active" || game.status === "finished");

  // Closed room (grace elapsed): dead code, bounce to home.
  useEffect(() => {
    if (error === "ROOM_CLOSED") router.replace("/");
  }, [error, router]);

  if (state && !myPid) {
    // Direct link without having joined: ask for a username first.
    return <JoinGate code={code} onJoined={(pid) => setMyPid(pid)} />;
  }

  return (
    <main className="min-h-dvh bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-950 text-white">
      {!state && <div className="p-8 text-center text-slate-400">Loading room…</div>}
      {state && !inGame && (
        <Lobby code={code} state={state} myPid={myPid} refresh={refresh} />
      )}
      {state && inGame && game && (
        <GameView code={code} state={state} myPid={myPid} refresh={refresh} />
      )}
    </main>
  );
}

function Lobby({
  code,
  state,
  myPid,
  refresh,
}: {
  code: string;
  state: NonNullable<ReturnType<typeof useRoomState>["state"]>;
  myPid: string | null;
  refresh: () => Promise<void>;
}) {
  const router = useRouter();
  const me = state.players.find((p) => p.id === myPid);
  const isHost = me?.is_host ?? false;
  const connectedCount = state.players.filter((p) => p.connected).length;

  async function closeRoom() {
    if (!confirm("Close this room? The code will stop working for everyone.")) return;
    await fetch("/api/rooms/close", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: state.room.id }),
    }).catch(() => {});
    router.push("/");
  }

  const [settings, setSettings] = useState({
    game_mode: "classic",
    difficulty: "medium",
    categories: ["General Knowledge"],
    timer_seconds: 15,
    total_rounds: 10,
    speed_bonus: true,
    streak_bonus: true,
    explanations: true,
  });

  const CATEGORIES = [
    "Science", "Technology", "Geography", "History", "Nature",
    "Space", "Culture", "Business", "Logic", "General Knowledge",
  ];

  function toggleCategory(c: string) {
    setSettings((s) => {
      const has = s.categories.includes(c);
      const next = has ? s.categories.filter((x) => x !== c) : [...s.categories, c];
      return { ...s, categories: next.length ? next : s.categories };
    });
  }

  async function startGame() {
    const res = await fetch("/api/game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "start", roomId: state.room.id, settings }),
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error);
    refresh();
  }

  async function setReady(ready: boolean) {
    await fetch("/api/game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "setReady", roomId: state.room.id, ready }),
    });
    refresh();
  }

  return (
    <div className="mx-auto max-w-md p-5 space-y-5">
      <header className="text-center pt-6">
        <p className="text-slate-400 text-xs uppercase tracking-widest">Room Code</p>
        <h1 className="text-5xl font-mono font-black tracking-[0.2em] text-amber-400">{code}</h1>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(
              `${location.origin}/${code}`
            );
            alert("Invite link copied!");
          }}
          className="mt-2 text-xs text-indigo-300 underline underline-offset-2"
        >
          Copy invite link
        </button>
      </header>

      <section className="rounded-2xl bg-white/5 border border-white/10 divide-y divide-white/5">
        {state.players.map((p) => (
          <div key={p.id} className="flex items-center justify-between px-4 py-3">
            <span className="font-medium">
              {p.display_name}
              {p.is_host && <span className="ml-2 text-[10px] uppercase bg-amber-400/20 text-amber-300 px-1.5 py-0.5 rounded">Host</span>}
              {!p.connected && <span className="ml-2 text-[10px] text-slate-500">offline</span>}
            </span>
            <span className={`text-xs ${p.is_ready ? "text-emerald-400" : "text-slate-500"}`}>
              {p.is_ready ? "Ready" : "Not ready"}
            </span>
          </div>
        ))}
        <div className="px-4 py-2 text-xs text-slate-500">
          {state.players.length}/{state.room.max_players} players — share the code to fill seats
        </div>
      </section>

      {isHost ? (
        <section className="space-y-4 rounded-2xl bg-white/5 border border-white/10 p-4">
          <h2 className="font-bold text-sm uppercase tracking-wide text-slate-300">Game Settings</h2>
          <div>
            <p className="text-xs text-slate-400 mb-1.5">Mode</p>
            <div className="grid grid-cols-3 gap-2">
              {["classic", "speed", "mixed"].map((m) => (
                <button key={m} onClick={() => setSettings((s) => ({ ...s, game_mode: m }))}
                  className={`rounded-lg py-2 text-sm capitalize border ${settings.game_mode === m ? "bg-amber-400 text-slate-950 border-amber-400 font-bold" : "border-white/15"}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-1.5">Difficulty</p>
            <div className="grid grid-cols-4 gap-2">
              {["easy", "medium", "hard", "adaptive"].map((d) => (
                <button key={d} onClick={() => setSettings((s) => ({ ...s, difficulty: d }))}
                  className={`rounded-lg py-2 text-xs capitalize border ${settings.difficulty === d ? "bg-amber-400 text-slate-950 border-amber-400 font-bold" : "border-white/15"}`}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-1.5">Timer</p>
            <div className="grid grid-cols-5 gap-2">
              {[5, 10, 15, 30, 60].map((t) => (
                <button key={t} onClick={() => setSettings((s) => ({ ...s, timer_seconds: t }))}
                  className={`rounded-lg py-2 text-sm border ${settings.timer_seconds === t ? "bg-amber-400 text-slate-950 border-amber-400 font-bold" : "border-white/15"}`}>
                  {t}s
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-1.5">Rounds</p>
            <div className="grid grid-cols-5 gap-2">
              {[5, 10, 15, 20, 30].map((r) => (
                <button key={r} onClick={() => setSettings((s) => ({ ...s, total_rounds: r }))}
                  className={`rounded-lg py-2 text-sm border ${settings.total_rounds === r ? "bg-amber-400 text-slate-950 border-amber-400 font-bold" : "border-white/15"}`}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-1.5">Categories</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button key={c} onClick={() => toggleCategory(c)}
                  className={`rounded-full px-3 py-1.5 text-xs border ${settings.categories.includes(c) ? "bg-indigo-500 border-indigo-400" : "border-white/15 text-slate-400"}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-1">
            {([["speed_bonus", "Speed pts"], ["streak_bonus", "Streak pts"], ["explanations", "Explain"]] as const).map(([key, label]) => (
              <button key={key} onClick={() => setSettings((s) => ({ ...s, [key]: !s[key] }))}
                className={`rounded-lg py-2 text-xs border ${settings[key] ? "bg-emerald-500/20 border-emerald-400/50 text-emerald-300" : "border-white/15 text-slate-500"}`}>
                {label} {settings[key] ? "ON" : "OFF"}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="rounded-2xl bg-white/5 border border-white/10 p-4 text-sm text-slate-400 text-center">
          Waiting for host to configure the game…
        </section>
      )}

      <div className="pb-8">
        {isHost ? (
          <>
            <button onClick={startGame} disabled={connectedCount < 2}
              className="w-full rounded-xl bg-amber-400 hover:bg-amber-300 active:scale-[0.98] disabled:opacity-40 text-slate-950 font-bold py-4 text-lg transition">
              {connectedCount < 2 ? "Waiting for players (min 2)…" : "Start Game"}
            </button>
            <button onClick={closeRoom}
              className="mt-2 w-full rounded-xl border border-rose-400/30 text-rose-300/80 text-xs py-2 active:scale-[0.99] transition">
              Close room
            </button>
          </>
        ) : me ? (
          <button onClick={() => setReady(!me.is_ready)}
            className={`w-full rounded-xl font-bold py-4 text-lg transition active:scale-[0.98] ${me.is_ready ? "bg-emerald-500 text-slate-950" : "bg-white/10 border border-white/15"}`}>
            {me.is_ready ? "Ready!" : "Tap when ready"}
          </button>
        ) : (
          <button onClick={() => router.push("/")}
            className="w-full rounded-xl bg-white/10 border border-white/15 font-bold py-4">
            You&apos;re spectating — go join properly
          </button>
        )}
      </div>
    </div>
  );
}

function GameView({
  code,
  state,
  myPid,
  refresh,
}: {
  code: string;
  state: NonNullable<ReturnType<typeof useRoomState>["state"]>;
  myPid: string | null;
  refresh: () => Promise<void>;
}) {
  const game = state.game!;
  const finished = game.status === "finished";
  const router = useRouter();
  const [round, setRound] = useState(Math.max(1, game.current_round));
  const [myAnswer, setMyAnswer] = useState<string | null>(null);

  useEffect(() => {
    if (!finished && game.current_round > 0) {
      // Defer to avoid cascading render lint error; sync on next tick.
      const id = setTimeout(() => setRound(game.current_round), 0);
      return () => clearTimeout(id);
    }
  }, [game.current_round, finished]);

  const { roundState, refresh: refreshRound } = useRound(game.id, round);
  const revealed = !!roundState?.closedAt;
  const { blurred, switchesRef } = useAntiCheat(game.id, myPid);

  useEffect(() => {
    if (revealed) {
      const id = setTimeout(() => setMyAnswer(null), 0);
      return () => clearTimeout(id);
    }
  }, [round, revealed]);

  const totalRounds = game.total_rounds;

  async function answer(option: string) {
    if (revealed || myAnswer) return;
    setMyAnswer(option);
    await fetch("/api/game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "answer", gameId: game.id, roundNumber: round, option }),
    });
    refreshRound();
  }

  async function closeAndAdvance() {
    await fetch("/api/game", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "closeRound",
        roomId: state.room.id,
        gameId: game.id,
        roundNumber: round,
        settings: {
          game_mode: game.game_mode,
          difficulty: game.difficulty,
          categories: game.categories,
          timer_seconds: game.timer_seconds,
          total_rounds: game.total_rounds,
          speed_bonus: true,
          streak_bonus: true,
          explanations: true,
        },
      }),
    });
    refreshRound();
    refresh();
  }

  const deadline = roundState?.deadlineAt ? new Date(roundState.deadlineAt).getTime() : null;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!deadline || revealed) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [deadline, revealed]);
  const secondsLeft = deadline && !revealed ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;

  const closeFiredRef = useRef<string | null>(null);
  useEffect(() => {
    if (deadline && !revealed && secondsLeft === 0 && closeFiredRef.current !== game?.id + round) {
      closeFiredRef.current = game?.id + round;
      closeAndAdvance();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secondsLeft, revealed, deadline]);

  const scores = useMemo(() => {
    return Object.entries(state.scores)
      .map(([id, pts]) => ({
        player: state.players.find((p) => p.id === id),
        pts,
      }))
      .filter((x) => x.player)
      .sort((a, b) => b.pts - a.pts);
  }, [state.scores, state.players]);

  const myResult = roundState?.answers?.find((a) => a.player_id === myPid);
  const [reportState, setReportState] = useState<"idle" | "open" | "sent" | "error">("idle");
  const [reportReason, setReportReason] = useState("wrong_answer");
  const [reportDetails, setReportDetails] = useState("");

  async function submitReport() {
    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        questionId: roundState?.question?.id,
        gameId: game.id,
        playerId: myPid,
        reason: reportReason,
        details: reportDetails || null,
      }),
    });
    setReportState(res.ok ? "sent" : "error");
  }

  return (
    <div
      className="mx-auto max-w-md p-5 space-y-4 select-none"
      style={blurred ? { filter: "blur(14px)", pointerEvents: "none" } : undefined}
    >
      <header className="flex items-center justify-between pt-4 text-sm">
        <button onClick={() => router.push("/")} className="text-slate-500">Exit</button>
        <span className="font-mono text-slate-300">
          {finished ? "Final" : `Round ${round}/${totalRounds}`}
        </span>
        <span className={`font-mono text-lg ${secondsLeft !== null && secondsLeft <= 5 ? "text-rose-400 animate-pulse" : "text-amber-400"}`}>
          {finished ? "" : revealed ? "—" : `${secondsLeft ?? "–"}s`}
        </span>
      </header>

      {roundState?.question && !finished && (
        <section className="space-y-3">
          <div className="flex gap-2 text-[10px] uppercase tracking-wide">
            <span className="rounded bg-indigo-500/20 text-indigo-300 px-2 py-0.5">{roundState.question.category}</span>
            <span className="rounded bg-white/10 text-slate-400 px-2 py-0.5">{roundState.question.difficulty}</span>
            <span className="rounded bg-white/10 text-slate-400 px-2 py-0.5">
              {roundState.answerCount} answered
            </span>
          </div>
          <h2 className="text-xl font-bold leading-snug">{roundState.question.question}</h2>
          <div className="space-y-2">
            {roundState.question.options.map((opt, i) => {
              const label = OPTION_LABELS[i];
              const isMine = myAnswer === label;
              const isCorrect = revealed && roundState?.correctOption === label;
              const isWrongPick = revealed && isMine && !isCorrect;
              return (
                <button key={label} disabled={revealed || !!myAnswer} onClick={() => answer(label)}
                  className={`w-full text-left rounded-xl border px-4 py-3 transition flex items-center gap-3
                    ${revealed
                      ? isCorrect ? "border-emerald-400 bg-emerald-500/20" : isWrongPick ? "border-rose-400 bg-rose-500/20" : "border-white/10 opacity-60"
                      : isMine ? "border-amber-400 bg-amber-400/20" : "border-white/15 bg-white/5 active:scale-[0.99]"}`}>
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold ${revealed && isCorrect ? "bg-emerald-400 text-slate-950" : "bg-white/10"}`}>
                    {label}
                  </span>
                  <span className="flex-1">{opt}</span>
                </button>
              );
            })}
          </div>
          {revealed && roundState?.explanation && (
            <div className="rounded-xl bg-indigo-500/10 border border-indigo-400/30 p-3 text-sm text-indigo-200">
              <span className="font-semibold">Why: </span>{roundState.explanation}
            </div>
          )}
          {!revealed && myAnswer && (
            <p className="text-center text-xs text-slate-400">Answer locked in — waiting for others…</p>
          )}
          {revealed && (
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Questions are checked, but mistakes happen.</span>
              {reportState === "idle" && (
                <button onClick={() => setReportState("open")} className="text-indigo-300 underline underline-offset-2 shrink-0 ml-2">
                  Report question
                </button>
              )}
              {reportState === "sent" && <span className="text-emerald-400 shrink-0 ml-2">Reported — thanks!</span>}
              {reportState === "error" && <span className="text-rose-400 shrink-0 ml-2">Failed — try again</span>}
            </div>
          )}
          {reportState === "open" && (
            <div className="rounded-xl bg-white/5 border border-white/10 p-3 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {([["wrong_answer", "Wrong answer"], ["unclear", "Unclear"], ["typo", "Typo"], ["inappropriate", "Inappropriate"], ["other", "Other"]] as const).map(([value, label]) => (
                  <button key={value} onClick={() => setReportReason(value)}
                    className={`rounded-full px-2.5 py-1 text-xs border ${reportReason === value ? "bg-indigo-500 border-indigo-400" : "border-white/15 text-slate-400"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <textarea
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value.slice(0, 500))}
                placeholder="Optional details…"
                rows={2}
                className="w-full rounded-lg bg-white/10 border border-white/15 px-3 py-2 text-sm outline-none focus:border-indigo-400/60 placeholder:text-slate-500"
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setReportState("idle")} className="rounded-lg px-3 py-1.5 text-xs border border-white/15 text-slate-400">
                  Cancel
                </button>
                <button onClick={submitReport} className="rounded-lg px-3 py-1.5 text-xs bg-indigo-500 font-semibold">
                  Submit report
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {finished && (
        <section className="space-y-4 pt-6 text-center">
          <h2 className="text-2xl font-black text-amber-400">Final Standings</h2>
        </section>
      )}

      <section className="rounded-2xl bg-white/5 border border-white/10 divide-y divide-white/5">
        {scores.map(({ player, pts }, i) => (
          <div key={player!.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <span>
              <span className="text-slate-500 mr-2">{i + 1}.</span>
              {player!.display_name}
              {player!.id === myPid && <span className="text-slate-500"> (you)</span>}
            </span>
            <span className="font-mono font-bold text-amber-400">{pts}</span>
          </div>
        ))}
        {scores.length === 0 && (
          <div className="px-4 py-3 text-xs text-slate-500">No points yet</div>
        )}
      </section>

      {revealed && !finished && (
        <button onClick={async () => {
          const next = round + 1;
          await fetch("/api/game", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "beginRound", gameId: game.id, roundNumber: next }),
          });
          setRound(next);
          refresh();
        }}
          className="w-full rounded-xl bg-amber-400 text-slate-950 font-bold py-3.5 active:scale-[0.98] transition">
          {myResult ? `You +${myResult.points ?? 0} — Next Round` : "Next Round"}
        </button>
      )}

      {finished && (
        <div className="space-y-2 pb-8">
          <button onClick={async () => {
            await fetch("/api/game", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "rematch", roomId: state.room.id }),
            });
            refresh();
          }}
            className="w-full rounded-xl bg-amber-400 text-slate-950 font-bold py-3.5">
            Rematch
          </button>
          <button onClick={() => router.push("/")}
            className="w-full rounded-xl bg-white/10 border border-white/15 font-semibold py-3">
            Back Home
          </button>
        </div>
      )}
    </div>
  );
}
