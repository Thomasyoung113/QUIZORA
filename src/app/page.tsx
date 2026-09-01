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
    <main className="min-h-dvh bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-950 text-white flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-2">
          <h1 className="text-5xl font-black tracking-tight">
            QUIZ<span className="text-amber-400">ORA</span>
          </h1>
          <p className="text-slate-400 text-sm">Think. Play. Discover.</p>
        </div>

        <input
          value={name}
          onChange={(e) => setName(e.target.value.slice(0, 24))}
          placeholder={user ? "Display name (optional)" : "Your username"}
          maxLength={24}
          className="w-full rounded-xl bg-white/10 border border-white/15 px-4 py-3 text-center text-lg outline-none focus:border-amber-400/60 placeholder:text-slate-500"
        />

        <button
          onClick={() => submit("create")}
          disabled={busy !== null || !canPlay}
          className="w-full rounded-xl bg-amber-400 hover:bg-amber-300 active:scale-[0.98] disabled:opacity-50 text-slate-950 font-bold py-3.5 text-lg transition"
        >
          {busy === "create" ? "Creating…" : "Create Room"}
        </button>

        <div className="flex items-center gap-3 text-slate-500 text-xs">
          <div className="h-px flex-1 bg-white/10" />
          OR JOIN
          <div className="h-px flex-1 bg-white/10" />
        </div>

        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6))}
          placeholder="ROOM CODE"
          maxLength={6}
          autoCapitalize="characters"
          className="w-full rounded-xl bg-white/10 border border-white/15 px-4 py-3 text-center text-2xl font-mono tracking-[0.3em] outline-none focus:border-amber-400/60 placeholder:text-slate-600"
        />

        <button
          onClick={() => submit("join")}
          disabled={busy !== null || code.length < 4 || !canPlay}
          className="w-full rounded-xl bg-white/10 hover:bg-white/15 active:scale-[0.98] disabled:opacity-40 border border-white/15 font-semibold py-3.5 text-lg transition"
        >
          {busy === "join" ? "Joining…" : "Join Room"}
        </button>

        {error && <p className="text-rose-400 text-sm text-center">{error}</p>}

        <div className="text-center space-y-2 pt-2">
          <Link href="/download" className="block text-xs text-amber-400/90 font-semibold underline underline-offset-2 hover:text-amber-300">
            Get the Android app
          </Link>
          <Link href="/how-to-play" className="block text-xs text-indigo-300 underline underline-offset-2 hover:text-indigo-200">
            How to play
          </Link>
          <AuthWidget />
          {user && (
            <Link href="/profile" className="block text-xs text-amber-400/90 font-semibold underline underline-offset-2 hover:text-amber-300">
              Profile &amp; stats
            </Link>
          )}
          <p className="text-slate-600 text-[11px]">
            By playing you agree to our{" "}
            <Link href="/legal" className="underline underline-offset-2 text-slate-400 hover:text-slate-300">Terms &amp; Privacy</Link>
          </p>
          <p className="text-slate-600 text-[11px]">QUIZORA© 2026</p>
        </div>
      </div>
    </main>
  );
}
