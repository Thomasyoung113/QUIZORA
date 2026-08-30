import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "How to Play — QUIZORA",
};

const steps = [
  {
    n: "1",
    title: "Create a room",
    body: "From the home page, enter your display name and tap Create Room. You'll get a 6-character room code (like R86AKC) and become the host. As host you pick the game settings before starting.",
  },
  {
    n: "2",
    title: "Invite your friends",
    body: "Share the room code with friends — they tap Join Room on the home page, type the code, and they're in. Everyone plays on their own phone, no accounts needed to play.",
  },
  {
    n: "3",
    title: "Host picks the settings",
    body: "Choose a game mode (see below), difficulty (Easy / Medium / Hard / Adaptive), which categories to draw questions from, the timer per question (5–60 seconds), and how many rounds (5–20). You can toggle speed and streak bonuses and post-answer explanations on or off.",
  },
  {
    n: "4",
    title: "Answer fast, answer right",
    body: "Each round shows a question with 4 options (A–D). Tap your answer before the timer runs out. Everyone answers the same question at the same time — after all answers are in (or the timer expires), the correct answer is revealed.",
  },
  {
    n: "5",
    title: "Watch the scoreboard",
    body: "After each reveal you see who got it right and the live standings. After the final round, the winner is crowned.",
  },
];

export default function HowToPlayPage() {
  return (
    <main className="min-h-dvh bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-950 text-white">
      <div className="mx-auto max-w-2xl px-6 py-12 space-y-10 text-sm leading-relaxed text-slate-300">
        <header>
          <h1 className="text-3xl font-black text-white">How to Play</h1>
          <p className="mt-2 text-slate-400">Everything you need to know in 2 minutes.</p>
        </header>

        <section className="space-y-5">
          {steps.map((s) => (
            <div key={s.n} className="flex gap-4">
              <div className="shrink-0 w-8 h-8 rounded-full bg-indigo-500 flex items-center justify-center font-bold text-white">
                {s.n}
              </div>
              <div>
                <h2 className="font-bold text-white">{s.title}</h2>
                <p className="mt-1">{s.body}</p>
              </div>
            </div>
          ))}
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-white">Game modes</h2>
          <ul className="space-y-2">
            <li><strong className="text-white">Classic</strong> — chill pace. Answer within the timer; no time pressure bonus.</li>
            <li><strong className="text-white">Speed Round</strong> — the fastest correct answer gets the full speed bonus. Blink and you lose points.</li>
            <li><strong className="text-white">Mixed Challenge</strong> — a blend: some rounds reward speed, some don&apos;t. Keeps everyone guessing.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-white">Scoring</h2>
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong className="text-white">Correct answer:</strong> 100 points. Always.</li>
            <li><strong className="text-white">Speed bonus</strong> (if enabled): up to +50 extra points for answering quickly — the faster you lock in, the more you get. In Speed Round mode the bonus is always at full value.</li>
            <li><strong className="text-white">Streak bonus</strong> (if enabled): 2 correct in a row starts a streak. Every extra consecutive answer adds +25, capped at +100. Chain 5+ correct answers to max it out.</li>
            <li><strong className="text-white">Wrong or no answer:</strong> 0 points, and your streak resets.</li>
          </ul>
          <p className="text-slate-400">Example: answer correctly at full speed on a 4-answer streak with both bonuses on → 100 + 50 + 75 = <strong className="text-white">225 points</strong> in one round.</p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-white">Question bank</h2>
          <p>
            Questions span 10 categories — Science, Technology, Geography, History, Nature, Space, Culture, Business, Logic, and General Knowledge — with thousands of questions in the bank and new ones added daily. Every question shows an explanation after the reveal (if the host has explanations on), so you learn something even when you get it wrong.
          </p>
          <p className="text-slate-400">
            Spotted a mistake? Tap <strong className="text-white">Report question</strong> right after the reveal — reports go straight to our review queue.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-white">Do I need an account?</h2>
          <p>
            No — you can play as a guest immediately. Signing in with email (optional) saves your stats and lets your results follow you across devices.
          </p>
        </section>

        <footer className="pt-4 pb-10 text-slate-500 text-xs">
          <a href="/" className="text-indigo-300 underline underline-offset-2">← Back to QUIZORA</a>
          <span className="mx-2">·</span>
          <a href="/legal" className="text-indigo-300 underline underline-offset-2">Terms &amp; Privacy</a>
        </footer>
      </div>
    </main>
  );
}
