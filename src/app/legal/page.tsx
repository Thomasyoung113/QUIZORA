import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms & Privacy — QUIZORA",
};

export default function LegalPage() {
  return (
    <main className="min-h-dvh bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-950 text-white">
      <div className="mx-auto max-w-2xl px-6 py-12 space-y-10 text-sm leading-relaxed text-slate-300">
        <header>
          <h1 className="text-3xl font-black text-white">Terms &amp; Privacy</h1>
          <p className="mt-2 text-slate-400">Plain English, no legalese. Last updated: August 30, 2026.</p>
        </header>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-white">What we collect</h2>
          <ul className="list-disc pl-5 space-y-1.5">
            <li><strong className="text-white">Display name</strong> you type when joining a room.</li>
            <li><strong className="text-white">Gameplay data</strong> — answers, scores, and room activity, so the game works and leaderboards are fair.</li>
            <li><strong className="text-white">A guest cookie</strong> (<code className="text-amber-300">quizora_pid</code> / <code className="text-amber-300">quizora_guest</code>) so you can rejoin rooms and keep your identity between rounds. These are strictly necessary cookies — we don&apos;t use ad or tracking cookies.</li>
            <li>If you sign in with Google: your <strong className="text-white">email and basic profile</strong>, used only to identify your account and save your stats across devices.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-white">What we don&apos;t do</h2>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>We don&apos;t sell, rent, or share your personal data with advertisers.</li>
            <li>We don&apos;t send marketing emails.</li>
            <li>We don&apos;t collect more than the game needs.</li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-white">Question accuracy</h2>
          <p>
            Questions — some community-sourced, some machine-assisted — are checked for accuracy,
            but we&apos;re human: mistakes happen. Every question has a <strong className="text-white">Report</strong> button.
            Reports go straight to our review queue and flagged questions get fixed or pulled.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-white">Your data, your call</h2>
          <p>
            Want your data deleted or a copy of it? Email <a href="mailto:devthomas113@gmail.com" className="text-amber-400 underline underline-offset-2">devthomas113@gmail.com</a> and
            we&apos;ll handle it within 30 days. You can also clear the guest cookies in your browser
            at any time — you&apos;ll just appear as a new player next game.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-white">Fair play</h2>
          <p>
            Don&apos;t cheat, script, or grief rooms. We may remove players or content that breaks
            the game for others. The service is provided &ldquo;as is&rdquo; — play nice, have fun.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-white">Contact</h2>
          <ul className="list-disc pl-5 space-y-1.5">
            <li>Telegram: <a href="https://t.me/thomas_young" className="text-amber-400 underline underline-offset-2">@thomas_young</a></li>
            <li>Email: <a href="mailto:devthomas113@gmail.com" className="text-amber-400 underline underline-offset-2">devthomas113@gmail.com</a></li>
          </ul>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold text-white">Credits</h2>
          <p>
            Some trivia questions are sourced from{" "}
            <a href="https://opentdb.com" className="text-amber-400 underline underline-offset-2">Open Trivia DB</a>,
            licensed under{" "}
            <a href="https://creativecommons.org/licenses/by-sa/4.0/" className="text-amber-400 underline underline-offset-2">CC-BY-SA 4.0</a>.
          </p>
        </section>

        <footer className="pt-4 pb-10 text-slate-500 text-xs">
          <a href="/" className="text-indigo-300 underline underline-offset-2">← Back to QUIZORA</a>
        </footer>
      </div>
    </main>
  );
}
