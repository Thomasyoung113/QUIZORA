import { NextRequest } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

export type SessionUser = { id: string; email: string | null };
export type Db = SupabaseClient<any, "public", "public", any, any>;

/**
 * Resolves the signed-in user from httpOnly auth cookies, refreshing the
 * access token when expired. Returns null for guests.
 */
export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  const at = req.cookies.get("quizora_at")?.value;
  const rt = req.cookies.get("quizora_rt")?.value;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon || (!at && !rt)) return null;

  const supabase = createClient(url, anon, { auth: { persistSession: false } });

  if (at) {
    const { data } = await supabase.auth.getUser(at);
    if (data?.user) return { id: data.user.id, email: data.user.email ?? null };
  }
  if (rt) {
    const { data } = await supabase.auth.refreshSession({ refresh_token: rt });
    if (data?.session && data.user) return { id: data.user.id, email: data.user.email ?? null };
  }
  return null;
}

/** Ensure a profiles row exists for the user. Username derived from email. */
export async function ensureProfile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  userId: string,
  email: string | null,
  fallbackName: string
): Promise<void> {
  const { data: existing } = await db.from("profiles").select("id").eq("id", userId).maybeSingle();
  if (existing) return;

  const base = (email?.split("@")[0] || fallbackName || "player").replace(/[^a-zA-Z0-9_]/g, "").slice(0, 20) || "player";
  // Uniquify username on collision
  for (let i = 0; i < 5; i++) {
    const username = i === 0 ? base : `${base}${Math.floor(Math.random() * 10000)}`;
    const { error } = await db.from("profiles").insert({ id: userId, username });
    if (!error) return;
  }
  // Last resort: fully random suffix
  await db.from("profiles").insert({ id: userId, username: `${base}${Date.now().toString(36)}` }).then(() => {});
}

/** Set auth cookies on a response (30-day session). */
export function setAuthCookiesOn(
  res: { cookies: { set: (opts: { name: string; value: string; httpOnly: boolean; secure: boolean; sameSite: "lax"; path: string; maxAge: number }) => void } },
  accessToken: string,
  refreshToken: string
): void {
  res.cookies.set({ name: "quizora_at", value: accessToken, httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 });
  res.cookies.set({ name: "quizora_rt", value: refreshToken, httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
}
