"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Shown when someone opens a room link directly without having joined.
 * Lets them set their username and join in place.
 */
export default function JoinGate({
  code,
  onJoined,
}: {
  code: string;
  onJoined: (playerId: string) => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function join() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, displayName: name.trim() || "Player" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Could not join");
      onJoined(data.playerId);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center p-6 bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-950 text-white">
      <div className="w-full max-w-sm space-y-5 text-center">
        <div>
          <h1 className="text-3xl font-black">Join room</h1>
          <p className="mt-1 text-slate-400">
            Room <span className="font-mono font-bold text-amber-400">{code}</span>
          </p>
        </div>

        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 24))}
          placeholder="Your username"
          maxLength={24}
          className="w-full rounded-xl bg-white/10 border border-white/15 px-4 py-3 text-center text-lg outline-none focus:border-amber-400/60 placeholder:text-slate-500"
        />

        {error && <p className="text-rose-400 text-sm">{error}</p>}

        <button
          onClick={join}
          disabled={busy}
          className="w-full rounded-xl bg-amber-400 hover:bg-amber-300 active:scale-[0.98] disabled:opacity-50 text-slate-950 font-bold py-3.5 text-lg transition"
        >
          {busy ? "Joining…" : "Join"}
        </button>

        <button
          onClick={() => router.push("/")}
          className="text-xs text-slate-500 underline underline-offset-2"
        >
          Back to home
        </button>
      </div>
    </div>
  );
}
