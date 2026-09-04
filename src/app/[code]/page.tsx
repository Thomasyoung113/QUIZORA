"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useRoomState, useRound } from "@/lib/client/store";
import { useAntiCheat } from "@/lib/client/anticheat";
import JoinGate from "@/components/join-gate";
import ShareCard from "@/components/share-card";

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
    <main className="min-h-dvh">
      {!state && <div className="p-8 text-center text-paper/50">Loading room…</div>}
      {state && !inGame && (
        <Lobby code={code} state={state} myPid={myPid} refresh={refresh} />
      )}
      {state && inGame && game && (
        <GameView state={state} myPid={myPid} refresh={refresh} code={code} />
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
        <p className="text-paper/50 text-xs uppercase tracking-widest">Room code</p>
        <h1 className="text-5xl font-mono font-black tracking-[0.2em] text-lime">{code}</h1>
        <button
          onClick={() => {
            navigator.clipboard?.writeText(
              `${location.origin}/${code}`
            );
            alert("Invite link copied!");
          }}
          className="mt-2 text-xs text-vio underline underline-offset-2 hover:text-paper"
        >
          Copy invite link
        </button>
      </header>

      <section className="q-panel rounded-2xl divide-y divide-paper/10">
        {state.players.map((p) => (
          <div key={p.id} className="flex items-center justify-between px-4 py-3">
            <span className="font-medium">
              {p.display_name}
              {p.is_host && <span className="ml-2 text-[10px] uppercase bg-lime text-ink px-1.5 py-0.5 rounded font-bold">Host</span>}
              {!p.connected && <span className="ml-2 text-[10px] text-paper/35">offline</span>}
            </span>
            <span className={`text-xs ${p.is_ready ? "text-mint font-bold" : "text-paper/35"}`}>
              {p.is_ready ? "Ready" : "Not ready"}
            </span>
          </div>
        ))}
        <div className="px-4 py-2 text-xs text-paper/40">
          {state.players.length}/{state.room.max_players} players — share the code to fill seats
        </div>
      </section>

      {isHost ? (
        <section className="space-y-4 rounded-2xl q-panel p-4">
          <h2 className="font-bold text-sm uppercase tracking-wide text-paper/80">Game Settings</h2>
          <div>
            <p className="text-xs text-paper/45 mb-1.5">Mode</p>
            <div className="grid grid-cols-3 gap-2">
              {["classic", "speed", "mixed"].map((m) => (
                <button key={m} onClick={() => setSettings((s) => ({ ...s, game_mode: m }))}
                  className={`rounded-lg py-2 text-sm capitalize border ${settings.game_mode === m ? "q-btn q-btn-primary rounded-lg" : "q-btn q-btn-ghost rounded-lg"}`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-paper/45 mb-1.5">Difficulty</p>
            <div className="grid grid-cols-4 gap-2">
              {["easy", "medium", "hard", "adaptive"].map((d) => (
                <button key={d} onClick={() => setSettings((s) => ({ ...s, difficulty: d }))}
                  className={`rounded-lg py-2 text-xs capitalize border ${settings.difficulty === d ? "q-btn q-btn-primary rounded-lg" : "q-btn q-btn-ghost rounded-lg"}`}>
                  {d}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-paper/45 mb-1.5">Timer</p>
            <div className="grid grid-cols-5 gap-2">
              {[5, 10, 15, 30, 60].map((t) => (
                <button key={t} onClick={() => setSettings((s) => ({ ...s, timer_seconds: t }))}
                  className={`rounded-lg py-2 text-sm border ${settings.timer_seconds === t ? "q-btn q-btn-primary rounded-lg" : "q-btn q-btn-ghost rounded-lg"}`}>
                  {t}s
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-paper/45 mb-1.5">Rounds</p>
            <div className="grid grid-cols-5 gap-2">
              {[5, 10, 15, 20, 30].map((r) => (
                <button key={r} onClick={() => setSettings((s) => ({ ...s, total_rounds: r }))}
                  className={`rounded-lg py-2 text-sm border ${settings.total_rounds === r ? "q-btn q-btn-primary rounded-lg" : "q-btn q-btn-ghost rounded-lg"}`}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs text-paper/45 mb-1.5">Categories</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button key={c} onClick={() => toggleCategory(c)}
                  className={`rounded-full px-3 py-1.5 text-xs border ${settings.categories.includes(c) ? "bg-vio border-vio text-ink font-bold" : "border-paper/25 text-paper/45"}`}>
                  {c}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 pt-1">
            {([["speed_bonus", "Speed pts"], ["streak_bonus", "Streak pts"], ["explanations", "Explain"]] as const).map(([key, label]) => (
              <button key={key} onClick={() => setSettings((s) => ({ ...s, [key]: !s[key] }))}
                className={`rounded-lg py-2 text-xs border ${settings[key] ? "border-mint/60 bg-mint/15 text-mint font-bold" : "border-paper/25 text-paper/35"}`}>
                {label} {settings[key] ? "ON" : "OFF"}
              </button>
            ))}
          </div>
        </section>
      ) : (
        <section className="rounded-2xl q-panel p-4 text-sm text-paper/50 text-center">
          Waiting for host to configure the game…
        </section>
      )}

      <div className="pb-8">
        {isHost ? (
          <>
            <button onClick={startGame} disabled={connectedCount < 2}
              className="q-btn q-btn-primary w-full rounded-xl py-4 text-lg disabled:opacity-40">
              {connectedCount < 2 ? "Waiting for players (min 2)…" : "Start Game"}
            </button>
            <button onClick={closeRoom}
              className="mt-2 w-full rounded-xl border border-coral/40 text-coral/90 text-xs py-2">
              Close room
            </button>
          </>
        ) : me ? (
          <button onClick={() => setReady(!me.is_ready)}
            className={`w-full rounded-xl font-bold py-4 text-lg transition active:scale-[0.98] ${me.is_ready ? "bg-lime text-ink border-2 border-ink shadow-[4px_4px_0_#14121f]" : "border-paper/25 text-paper font-bold"}`}>
            {me.is_ready ? "Ready!" : "Tap when ready"}
          </button>
        ) : (
          <button onClick={() => router.push("/")}
            className="q-btn q-btn-ghost w-full rounded-xl py-4">
            You&apos;re spectating — go join properly
          </button>
        )}
      </div>
    </div>
  );
}

function GameView({
  state,
  myPid,
  refresh,
}: {
  state: NonNullable<ReturnType<typeof useRoomState>["state"]>;
  myPid: string | null;
  refresh: () => Promise<void>;
  code: string;
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
  const { blurred } = useAntiCheat(game.id, myPid);

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
    // 1s tick is enough — display is whole seconds; 250ms caused 4x/s
    // full-page re-renders (noticeable lag on low-end phones).
    const t = setInterval(() => setNow(Date.now()), 1000);
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

  // Track my correct/answered across rounds for the share card.
  const [tally, setTally] = useState({ correct: 0, answered: 0 });
  const tallyKey = finished ? null : `${game.id}:${round}:${revealed ? "r" : "o"}`;
  const lastTallyKey = useRef<string | null>(null);
  useEffect(() => {
    if (!tallyKey || !revealed || !myResult || lastTallyKey.current === tallyKey) return;
    lastTallyKey.current = tallyKey;
    setTally((t) => ({
      correct: t.correct + (myResult.is_correct ? 1 : 0),
      answered: t.answered + 1,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tallyKey, revealed]);
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
        <button onClick={() => router.push("/")} className="text-paper/40 hover:text-paper">Exit</button>
        <span className="font-mono text-paper/70">
          {finished ? "Final" : `Round ${round}/${totalRounds}`}
        </span>
        <span className={`font-mono text-lg ${secondsLeft !== null && secondsLeft <= 5 ? "text-coral animate-pulse" : "text-lime"}`}>
          {finished ? "" : revealed ? "—" : `${secondsLeft ?? "–"}s`}
        </span>
      </header>

      {roundState?.question && !finished && (
        <section className="space-y-3">
          <div className="flex gap-2 text-[10px] uppercase tracking-wide">
            <span className="q-chip-dark rounded-full px-2 py-0.5 text-vio">{roundState.question.category}</span>
            <span className="q-chip-dark rounded-full px-2 py-0.5">{roundState.question.difficulty}</span>
            <span className="q-chip-dark rounded-full px-2 py-0.5">
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
                      ? isCorrect ? "border-mint bg-mint/20" : isWrongPick ? "border-coral bg-coral/20" : "border-paper/10 opacity-50"
                      : isMine ? "border-lime bg-lime/15" : "border-paper/20 bg-paper/5 active:scale-[0.99]"}`}>
                  <span className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold ${revealed && isCorrect ? "bg-mint text-ink" : "bg-paper/10"}`}>
                    {label}
                  </span>
                  <span className="flex-1">{opt}</span>
                </button>
              );
            })}
          </div>
          {revealed && roundState?.explanation && (
            <div className="rounded-xl bg-vio/10 border border-vio/40 p-3 text-sm text-paper/85">
              <span className="font-semibold">Why: </span>{roundState.explanation}
            </div>
          )}
          {!revealed && myAnswer && (
            <p className="text-center text-xs text-paper/45">Answer locked in — waiting for others…</p>
          )}
          {revealed && (
            <div className="flex items-center justify-between text-xs text-paper/35">
              <span>Questions are checked, but mistakes happen.</span>
              {reportState === "idle" && (
                <button onClick={() => setReportState("open")} className="text-vio underline underline-offset-2 shrink-0 ml-2 hover:text-paper">
                  Report question
                </button>
              )}
              {reportState === "sent" && <span className="text-mint shrink-0 ml-2">Reported — thanks!</span>}
              {reportState === "error" && <span className="text-coral shrink-0 ml-2">Failed — try again</span>}
            </div>
          )}
          {reportState === "open" && (
            <div className="rounded-xl q-panel p-3 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {([["wrong_answer", "Wrong answer"], ["unclear", "Unclear"], ["typo", "Typo"], ["inappropriate", "Inappropriate"], ["other", "Other"]] as const).map(([value, label]) => (
                  <button key={value} onClick={() => setReportReason(value)}
                    className={`rounded-full px-2.5 py-1 text-xs border ${reportReason === value ? "bg-vio border-vio text-ink font-bold" : "border-paper/25 text-paper/45"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <textarea
                value={reportDetails}
                onChange={(e) => setReportDetails(e.target.value.slice(0, 500))}
                placeholder="Optional details…"
                rows={2}
                className="q-input w-full rounded-lg px-3 py-2 text-sm"
              />
              <div className="flex gap-2 justify-end">
                <button onClick={() => setReportState("idle")} className="rounded-lg px-3 py-1.5 text-xs border border-paper/25 text-paper/45 hover:text-paper">
                  Cancel
                </button>
                <button onClick={submitReport} className="rounded-lg px-3 py-1.5 text-xs bg-lime text-ink font-bold">
                  Submit report
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      {finished && (
        <section className="space-y-4 pt-6 text-center">
          <h2 className="text-2xl font-black text-lime">Final Standings</h2>
        </section>
      )}

      <section className="q-panel rounded-2xl divide-y divide-paper/10">
        {scores.map(({ player, pts }, i) => (
          <div key={player!.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <span>
              <span className="text-paper/35 mr-2">{i + 1}.</span>
              {player!.display_name}
              {player!.id === myPid && <span className="text-paper/35"> (you)</span>}
            </span>
            <span className="font-mono font-bold text-lime">{pts}</span>
          </div>
        ))}
        {scores.length === 0 && (
          <div className="px-4 py-3 text-xs text-paper/35">No points yet</div>
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
          className="q-btn q-btn-primary w-full rounded-xl py-3.5">
          {myResult ? `You +${myResult.points ?? 0} — Next Round` : "Next Round"}
        </button>
      )}

      {finished && (
        <div className="space-y-2 pb-8">
          <ShareCard
            playerName={state.players.find((p) => p.id === myPid)?.display_name ?? "Player"}
            rank={scores.findIndex((s) => s.player!.id === myPid) + 1 || scores.length}
            playerCount={scores.length}
            points={scores.find((s) => s.player!.id === myPid)?.pts ?? 0}
            correct={tally.correct}
            answered={tally.answered}
            roomCode={state.room.room_code}
          />
          <button onClick={async () => {
            await fetch("/api/game", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "rematch", roomId: state.room.id }),
            });
            refresh();
          }}
            className="q-btn q-btn-primary w-full rounded-xl py-3.5">
            Rematch
          </button>
          <button onClick={() => router.push("/")}
            className="q-btn q-btn-ghost w-full rounded-xl py-3">
            Back Home
          </button>
        </div>
      )}
    </div>
  );
}
