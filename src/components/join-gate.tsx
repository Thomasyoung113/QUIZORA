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
    <div className="min-h-dvh flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-5 text-center">
        <div>
          <div className="inline-flex q-chip mb-3">Brain battle</div>
          <h1 className="q-display text-3xl">Join room</h1>
          <p className="mt-1 text-paper/50">
            Room <span className="font-mono font-bold text-lime">{code}</span>
          </p>
        </div>

        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 24))}
          placeholder="Your username"
          maxLength={24}
          className="q-input w-full rounded-xl px-4 py-3 text-center text-lg"
        />

        {error && <p className="text-coral text-sm font-semibold">{error}</p>}

        <button
          onClick={join}
          disabled={busy}
          className="q-btn q-btn-primary w-full rounded-xl py-3.5 text-lg disabled:opacity-50"
        >
          {busy ? "Joining…" : "Join"}
        </button>

        <button
          onClick={() => router.push("/")}
          className="text-xs text-paper/40 underline underline-offset-2 hover:text-paper"
        >
          Back to home
        </button>
      </div>
    </div>
  );
}
