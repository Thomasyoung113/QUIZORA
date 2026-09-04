import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Download QUIZORA — Android App",
  description: "Get the QUIZORA Android app. Think. Play. Discover.",
};

const features = [
  { title: "Live 1v1 battles", text: "Real-time quiz duels over SSE — no refresh, no lag." },
  { title: "Tournaments", text: "4-player bracket play for the crown." },
  { title: "24k+ questions", text: "10 categories, from history to hard science." },
  { title: "Lightweight", text: "Under 150 KB. Instant install, no bloat." },
];

export default function DownloadPage() {
  return (
    <main className="min-h-dvh  flex flex-col items-center p-6">
      <div className="w-full max-w-sm space-y-6 py-10">
        <div className="text-center space-y-2">
          <h1 className="text-4xl font-black tracking-tight">
            Get QUIZ<span className="text-lime">ORA</span>
          </h1>
          <p className="text-paper/50 text-sm">The app. In your pocket. Free.</p>
        </div>

        <a
          href="/downloads/quizora.apk"
          download="QUIZORA.apk"
          className="block w-full rounded-xl bg-lime text-ink font-bold py-4 text-lg text-center transition"
        >
          Download for Android
        </a>
        <p className="text-center text-xs text-paper/40">
          v1.0 · Android 5.0+ · ~130 KB
        </p>

        <div className="space-y-3">
          {features.map((f) => (
            <div key={f.title} className="rounded-xl bg-paper/5 border border-paper/15 px-4 py-3">
              <p className="font-semibold text-sm">{f.title}</p>
              <p className="text-paper/50 text-xs">{f.text}</p>
            </div>
          ))}
        </div>

        <details className="rounded-xl bg-paper/5 border border-paper/15 px-4 py-3 text-sm">
          <summary className="cursor-pointer font-semibold">Install instructions</summary>
          <ol className="mt-2 space-y-1.5 text-paper/50 text-xs list-decimal list-inside">
            <li>Tap the download button above.</li>
            <li>Open the APK from your notifications or Downloads folder.</li>
            <li>If asked, allow &quot;Install unknown apps&quot; for your browser.</li>
            <li>Tap Install — done. Open QUIZORA and play.</li>
          </ol>
        </details>

        <div className="text-center space-y-2 pt-2">
          <Link href="/" className="block text-xs text-vio underline underline-offset-2 hover:text-paper">
            Back to play in browser
          </Link>
          <p className="text-paper/30 text-[11px]">QUIZORA© 2026</p>
        </div>
      </div>
    </main>
  );
}
