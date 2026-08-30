"use client";

import { useEffect, useState } from "react";

type User = { id: string; email: string | null } | null;

export default function AuthWidget() {
  const [user, setUser] = useState<User>(undefined as unknown as User); // undefined = loading
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"closed" | "email" | "code">("closed");
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => setUser(d.user ?? null))
      .catch(() => setUser(null));
  }, []);

  async function sendCode() {
    setBusy(true); setMsg("");
    const res = await fetch("/api/auth/request", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });
    setBusy(false);
    if (res.ok) { setStage("code"); setMsg("Check your email for the 6-digit code"); }
    else setMsg("Could not send — try again");
  }

  async function verify() {
    setBusy(true); setMsg("");
    const res = await fetch("/api/auth/verify", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, token: code }),
    });
    setBusy(false);
    if (res.ok) {
      const d = await res.json();
      setUser(d.user); setStage("closed"); setMsg("");
    } else setMsg("Wrong or expired code");
  }

  async function signOut() {
    await fetch("/api/auth/session", { method: "DELETE" });
    setUser(null);
  }

  if (user === undefined) return null;
  if (user) {
    return (
      <div className="flex items-center gap-2 text-xs text-slate-400">
        <span className="max-w-40 truncate">{user.email}</span>
        <button onClick={signOut} className="underline underline-offset-2 hover:text-slate-300">Sign out</button>
      </div>
    );
  }

  return (
    <div className="text-xs">
      {stage === "closed" && (
        <button onClick={() => setStage("email")} className="text-indigo-300 underline underline-offset-2 hover:text-indigo-200">
          Sign in with email
        </button>
      )}
      {stage === "email" && (
        <div className="space-y-1.5">
          <div className="flex gap-1.5">
            <input
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com"
              className="rounded-lg bg-white/10 border border-white/15 px-2.5 py-1.5 w-44 outline-none focus:border-indigo-400/60 placeholder:text-slate-500"
            />
            <button onClick={sendCode} disabled={busy || !email.includes("@")}
              className="rounded-lg bg-indigo-500 px-3 py-1.5 font-semibold disabled:opacity-40">
              {busy ? "…" : "Send code"}
            </button>
          </div>
          {msg && <p className="text-slate-400">{msg}</p>}
        </div>
      )}
      {stage === "code" && (
        <div className="space-y-1.5">
          <div className="flex gap-1.5">
            <input
              value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="123456" inputMode="numeric"
              className="rounded-lg bg-white/10 border border-white/15 px-2.5 py-1.5 w-32 tracking-widest outline-none focus:border-indigo-400/60 placeholder:text-slate-500"
            />
            <button onClick={verify} disabled={busy || code.length < 6}
              className="rounded-lg bg-indigo-500 px-3 py-1.5 font-semibold disabled:opacity-40">
              {busy ? "…" : "Verify"}
            </button>
          </div>
          {msg && <p className="text-slate-400">{msg}</p>}
        </div>
      )}
    </div>
  );
}
