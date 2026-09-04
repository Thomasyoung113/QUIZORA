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
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  useEffect(() => {
    fetch("/api/auth/session")
      .then((r) => r.json())
      .then((d) => setUser(d.user ?? null))
      .catch(() => setUser(null));
  }, []);

  async function sendCode() {
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/auth/request", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setBusy(false);
      if (res.ok) { setStage("code"); setMsg("Check your email for the 6-digit code"); setResendIn(60); }
      else setMsg("Could not send — try again");
    } catch {
      setBusy(false);
      setMsg("Network error — check your connection");
    }
  }

  async function verify() {
    setBusy(true); setMsg("");
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token: code }),
      });
      setBusy(false);
      if (res.ok) {
        const d = await res.json();
        setUser(d.user); setStage("closed"); setMsg("");
      } else setMsg("Wrong or expired code");
    } catch {
      setBusy(false);
      setMsg("Network error — check your connection");
    }
  }

  async function signOut() {
    await fetch("/api/auth/session", { method: "DELETE" });
    setUser(null);
  }

  if (user === undefined) return null;
  if (user) {
    return (
      <div className="flex items-center gap-2 text-xs text-paper/50">
        <span className="max-w-40 truncate">{user.email}</span>
        <button onClick={signOut} className="underline underline-offset-2 hover:text-paper">Sign out</button>
      </div>
    );
  }

  return (
    <div className="text-xs">
      {stage === "closed" && (
        <button onClick={() => setStage("email")} className="text-vio underline underline-offset-2 hover:text-paper">
          Sign in with email
        </button>
      )}
      {stage === "email" && (
        <div className="w-full space-y-2">
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="you@email.com"
            className="q-input w-full rounded-xl px-4 py-3 text-center"
          />
          <button onClick={sendCode} disabled={busy || !email.includes("@")}
            className="q-btn q-btn-primary w-full rounded-xl py-3 disabled:opacity-40">
            {busy ? "Sending…" : "Send code"}
          </button>
          {msg && <p className="text-paper/50 text-xs text-center">{msg}</p>}
        </div>
      )}
      {stage === "code" && (
        <div className="w-full space-y-2">
          <input
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="123456" inputMode="numeric" autoFocus
            className="q-input w-full rounded-xl px-4 py-3 text-center text-lg tracking-[0.4em]"
          />
          <button onClick={verify} disabled={busy || code.length < 6}
            className="q-btn q-btn-primary w-full rounded-xl py-3 disabled:opacity-40">
            {busy ? "Verifying…" : "Verify"}
          </button>
          {msg && <p className="text-paper/50 text-xs text-center">{msg}</p>}
          <p className="text-xs text-paper/40 text-center">
            {resendIn > 0 ? (
              `Resend code in ${resendIn}s`
            ) : (
              <button onClick={sendCode} disabled={busy} className="underline underline-offset-2 hover:text-paper disabled:opacity-40">
                Didn&apos;t get it? Resend code
              </button>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
