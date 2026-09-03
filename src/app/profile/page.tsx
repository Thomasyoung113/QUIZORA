"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { AVATAR_PRESET_SLUGS, presetAvatarDataUriClient } from "@/lib/avatars";

type Rank = { tier: string; color: string; rating: number; nextTier: string | null; progress: number };
type Achievement = { id: string; name: string; description: string; tier: string; unlocked: boolean; unlockedAt: string | null };
type GameRow = {
  id: string;
  won: boolean;
  score: number;
  opponent_name: string | null;
  correct: number;
  answered: number;
  avg_answer_ms: number | null;
  finished_at: string;
};
type ProfileData = {
  profile: {
    username: string;
    avatarUrl: string | null;
    avatarRaw: string | null;
    xp: number;
    totalGames: number;
    totalWins: number;
    totalQuestions: number;
    correctAnswers: number;
    bestStreak: number;
    avgAnswerMs: number | null;
    rating: number;
    winRate: number;
  };
  rank: Rank;
  achievements: Achievement[];
  games: GameRow[];
  categoryStats: Array<{ category: string; wins: number; games: number }>;
};

const TIER_STYLES: Record<string, string> = {
  Bronze: "border-amber-700/60 text-amber-600",
  Silver: "border-slate-300/60 text-slate-200",
  Gold: "border-amber-400/70 text-amber-400",
  Epic: "border-fuchsia-400/70 text-fuchsia-400",
};

function relTime(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

async function resizeTo256Png(file: File): Promise<Blob> {
  const img = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unsupported");
  const side = Math.min(img.width, img.height);
  ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 256, 256);
  return await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob failed"))), "image/png")
  );
}

export default function ProfilePage() {
  const [data, setData] = useState<ProfileData | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error" | "guest">("loading");
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/profile")
      .then(async (r) => {
        if (r.status === 401) { setState("guest"); return; }
        if (!r.ok) throw new Error("Failed to load profile");
        const d = await r.json();
        setData(d);
        setNameDraft(d.profile.username);
        setState("ready");
      })
      .catch(() => setState("error"));
  }, []);

  async function save(patch: Record<string, unknown>) {
    setSaving(true);
    setMsg(null);
    try {
      const r = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Save failed");
      setData((prev) =>
        prev
          ? {
              ...prev,
              profile: { ...prev.profile, ...(d.profile ?? {}) },
            }
          : prev
      );
      setMsg("Saved");
      if (patch.username !== undefined) setEditing(false);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Error");
    } finally {
      setSaving(false);
    }
  }

  async function uploadAvatar(file: File) {
    setSaving(true);
    setMsg(null);
    try {
      const blob = await resizeTo256Png(file);
      const form = new FormData();
      form.append("file", new File([blob], "avatar.png", { type: "image/png" }));
      const r = await fetch("/api/profile/avatar-upload", { method: "POST", body: form });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Upload failed");
      setData((prev) => (prev ? { ...prev, profile: { ...prev.profile, avatarUrl: d.avatarUrl, avatarRaw: d.raw } } : prev));
      setMsg("Avatar updated");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Upload error");
    } finally {
      setSaving(false);
    }
  }

  if (state === "loading") {
    return (
      <main className="min-h-dvh bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-950 text-white p-6">
        <div className="max-w-sm mx-auto space-y-4 animate-pulse">
          <div className="h-24 rounded-xl bg-white/5" />
          <div className="h-32 rounded-xl bg-white/5" />
          <div className="h-40 rounded-xl bg-white/5" />
        </div>
      </main>
    );
  }

  if (state === "guest" || state === "error") {
    return (
      <main className="min-h-dvh bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-950 text-white flex items-center justify-center p-6">
        <div className="text-center space-y-3 max-w-xs">
          <h1 className="text-2xl font-bold">{state === "guest" ? "Log in to see your profile" : "Could not load profile"}</h1>
          <p className="text-slate-400 text-sm">
            {state === "guest" ? "Your stats, achievements and rank live here once you are signed in." : "Try again in a moment."}
          </p>
          <Link href="/" className="inline-block rounded-xl bg-amber-400 text-slate-950 font-bold px-6 py-3">
            Back to home
          </Link>
        </div>
      </main>
    );
  }

  if (!data) return null;
  const { profile, rank, achievements, games } = data;
  const unlockedCount = achievements.filter((a) => a.unlocked).length;

  return (
    <main className="min-h-dvh bg-gradient-to-b from-slate-950 via-indigo-950 to-slate-950 text-white p-6">
      <div className="max-w-sm mx-auto space-y-5 py-6">
        {/* Header card */}
        <section className="rounded-2xl bg-white/5 border border-white/10 p-4 flex items-center gap-4">
          {profile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.avatarUrl} alt="" className="w-16 h-16 rounded-xl object-cover" />
          ) : (
            <div className="w-16 h-16 rounded-xl bg-white/10" />
          )}
          <div className="flex-1 min-w-0">
            {editing ? (
              <div className="space-y-2">
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 24))}
                  className="w-full rounded-lg bg-white/10 border border-white/15 px-3 py-2 text-sm outline-none focus:border-amber-400/60"
                />
                <div className="flex gap-2">
                  <button onClick={() => save({ username: nameDraft })} disabled={saving || nameDraft.length < 3} className="rounded-lg bg-amber-400 text-slate-950 font-bold px-3 py-1.5 text-xs disabled:opacity-40">
                    Save
                  </button>
                  <button onClick={() => { setEditing(false); setNameDraft(profile.username); }} className="rounded-lg bg-white/10 px-3 py-1.5 text-xs">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <p className="font-bold text-lg truncate">{profile.username}</p>
                <span className="inline-block mt-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide" style={{ borderColor: rank.color, color: rank.color }}>
                  {rank.tier.toUpperCase()} · {rank.rating}
                </span>
              </>
            )}
          </div>
          {!editing && (
            <button onClick={() => setEditing(true)} className="rounded-lg bg-white/10 border border-white/15 px-3 py-1.5 text-xs font-semibold">
              Edit
            </button>
          )}
        </section>

        {msg && <p className="text-center text-xs text-slate-400">{msg}</p>}

        {/* Avatar picker (edit mode) */}
        {editing && (
          <section className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-3">
            <p className="text-xs font-semibold text-slate-300 tracking-wide">AVATAR</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {AVATAR_PRESET_SLUGS.map((slug) => (
                <button
                  key={slug}
                  onClick={() => save({ avatar: slug })}
                  disabled={saving}
                  className={`shrink-0 rounded-xl overflow-hidden border-2 ${profile.avatarRaw === slug ? "border-amber-400" : "border-transparent"}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={presetAvatarDataUriClient(slug)} alt="" className="w-14 h-14" />
                </button>
              ))}
              <label className="shrink-0 w-14 h-14 rounded-xl bg-white/10 border border-dashed border-white/25 text-[10px] font-semibold text-slate-300 flex items-center justify-center cursor-pointer">
                Upload
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="sr-only"
                  disabled={saving}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadAvatar(f);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          </section>
        )}

        {/* Rank card */}
        <section className="rounded-2xl bg-white/5 border border-white/10 p-4 space-y-2">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-bold" style={{ color: rank.color }}>{rank.tier}</p>
            <p className="text-xs text-slate-400">{rank.rating} RP</p>
          </div>
          <div className="h-2 rounded-full bg-white/10 overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${rank.progress}%`, backgroundColor: "#FBBF24" }} />
          </div>
          <p className="text-[11px] text-slate-500">{rank.nextTier ? `${rank.progress}% to ${rank.nextTier}` : "Top tier"}</p>
        </section>

        {/* Stats grid */}
        <section className="grid grid-cols-3 gap-2">
          {[
            { label: "Games", value: profile.totalGames },
            { label: "Win rate", value: `${profile.winRate}%` },
            { label: "Correct", value: profile.correctAnswers },
            { label: "Best streak", value: profile.bestStreak },
            { label: "Avg answer", value: profile.avgAnswerMs != null ? `${(profile.avgAnswerMs / 1000).toFixed(1)}s` : "-" },
            { label: "XP", value: profile.xp },
          ].map((s) => (
            <div key={s.label} className="rounded-xl bg-white/5 border border-white/10 p-3 text-center">
              <p className="text-lg font-black">{s.value}</p>
              <p className="text-[10px] text-slate-500 tracking-wide">{s.label.toUpperCase()}</p>
            </div>
          ))}
        </section>

        {/* Achievements */}
        <section className="space-y-2">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="text-sm font-bold tracking-wide">ACHIEVEMENTS</h2>
            <p className="text-xs text-slate-500">{unlockedCount}/{achievements.length}</p>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {achievements.map((a) => (
              <div
                key={a.id}
                className={`rounded-xl border p-2.5 text-center ${a.unlocked ? TIER_STYLES[a.tier] ?? "border-white/20 text-white" : "border-white/10 bg-white/5 opacity-50"}`}
              >
                <p className="text-[11px] font-bold leading-tight">{a.name}</p>
                <p className="text-[9px] text-slate-500 mt-0.5 tracking-widest">{a.unlocked ? a.tier.toUpperCase() : "LOCKED"}</p>
                <p className="text-[9px] text-slate-500 mt-1 leading-snug">{a.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Recent games */}
        <section className="space-y-2">
          <h2 className="text-sm font-bold tracking-wide px-1">RECENT GAMES</h2>
          {games.length === 0 && <p className="text-xs text-slate-500 px-1">No games yet — play one to start your history.</p>}
          {games.map((g) => (
            <div key={g.id} className="rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 flex items-center gap-3">
              <span className={`rounded-md px-2 py-0.5 text-[10px] font-black ${g.won ? "bg-amber-400 text-slate-950" : "bg-white/10 text-slate-400"}`}>
                {g.won ? "W" : "L"}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate">
                  {g.score} pts <span className="text-slate-500 font-normal">vs {g.opponent_name ?? "?"}</span>
                </p>
                <p className="text-[10px] text-slate-500">
                  {g.correct}/{g.answered} correct
                  {g.avg_answer_ms != null ? ` · ${(g.avg_answer_ms / 1000).toFixed(1)}s avg` : ""}
                </p>
              </div>
              <span className="text-[10px] text-slate-500 shrink-0">{relTime(g.finished_at)}</span>
            </div>
          ))}
        </section>

        <Link href="/" className="block text-center text-xs text-indigo-300 underline underline-offset-2 hover:text-indigo-200 pt-2">
          Back to QUIZORA
        </Link>
      </div>
    </main>
  );
}
