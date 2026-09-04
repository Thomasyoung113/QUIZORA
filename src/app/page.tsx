"use client";
import Link from "next/link";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { track } from "@/components/analytics-provider";
import AuthWidget from "@/components/auth-widget";

export default function Home() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [user, setUser] = useState<{ id: string; email: string | null } | null>(undefined as unknown as { id: string; email: string | null } | null); // undefined = loading

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setUser(d.user ?? null))
      .catch(() => setUser(null));
  }, []);

  const canPlay = user ? true : name.trim().length >= 2;

  async function submit(action: "create" | "join") {
    if (!canPlay) {
      setError(user === null ? "Enter a username or log in first" : "Enter a username");
      return;
    }
    setBusy(action);
    setError(null);
    try {
      const fallbackName = user?.email?.split("@")[0].slice(0, 24) ?? "";
      const displayName = name.trim() || fallbackName;
      if (!displayName) throw new Error("Enter a username first");
      const res = await fetch(`/api/rooms/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          action === "create"
            ? { displayName }
            : { code: code.trim().toUpperCase(), displayName }
        ),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");
      track(`room_${action}`, { code: data.roomCode ?? code.trim().toUpperCase(), authenticated: !!user });
      router.push(`/${data.roomCode ?? code.trim().toUpperCase()}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error");
      setBusy(null);
    }
  }

  return (
    <main className="min-h-dvh flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-3">
          <div className="inline-flex q-chip">Real-time brain battles</div>
          <h1 className="q-display text-6xl leading-none">
            QUIZ<span className="text-lime">ORA</span>
          </h1>
          <p className="text-sm tracking-[0.3em] uppercase text-paper/50">Think. Play. Discover.</p>
        </div>

        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 24))}
          placeholder={user ? "Display name (optional)" : "Your username"}
          maxLength={24}
          className="q-input w-full rounded-xl px-4 py-3 text-center text-lg"
        />

        <button
          onClick={() => submit("create")}
          disabled={busy !== null || !canPlay}
          className="q-btn q-btn-primary w-full rounded-xl py-3.5 text-lg disabled:opacity-50"
        >
          {busy === "create" ? "Creating…" : "Create Room"}
        </button>

        <div className="flex items-center gap-3 text-paper/35 text-xs uppercase tracking-widest">
          <div className="h-px flex-1 bg-paper/15" />
          Or join
          <div className="h-px flex-1 bg-paper/15" />
        </div>

        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
          placeholder="ROOM CODE"
          maxLength={6}
          autoCapitalize="characters"
          className="q-input w-full rounded-xl px-4 py-3 text-center text-2xl font-mono tracking-[0.3em]"
        />

        <button
          onClick={() => submit("join")}
          disabled={busy !== null || code.length < 4 || !canPlay}
          className="q-btn q-btn-ghost w-full rounded-xl py-3.5 text-lg disabled:opacity-40"
        >
          {busy === "join" ? "Joining…" : "Join Room"}
        </button>

        {error && <p className="text-coral text-sm text-center font-semibold">{error}</p>}

        <div className="text-center space-y-2 pt-2">
          <Link href="/download" className="block text-xs text-lime font-bold underline underline-offset-2">
            Get the Android app
          </Link>
          <Link href="/how-to-play" className="block text-xs text-vio underline underline-offset-2 hover:text-paper">
            How to play
          </Link>
          <AuthWidget />
          {user && (
            <Link href="/profile" className="block text-xs text-lime font-bold underline underline-offset-2">
              Profile &amp; stats
            </Link>
          )}
          <p className="text-paper/35 text-[11px]">
            By playing you agree to our{" "}
            <Link href="/legal" className="underline underline-offset-2 text-paper/60 hover:text-paper">Terms &amp; Privacy</Link>
          </p>
          <p className="text-paper/25 text-[11px]">QUIZORA© 2026</p>
        </div>
      </div>
    </main>
  );
}
