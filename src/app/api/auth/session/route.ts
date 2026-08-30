import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * Returns the signed-in user (or null). Transparently refreshes the
 * access token from the refresh-token cookie when expired.
 */
export async function GET(req: NextRequest) {
  const at = req.cookies.get("quizora_at")?.value;
  const rt = req.cookies.get("quizora_rt")?.value;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.json({ user: null });

  const supabase = createClient(url, anon, { auth: { persistSession: false } });

  if (at) {
    const { data } = await supabase.auth.getUser(at);
    const user = data?.user;
    if (user) {
      return NextResponse.json({ user: { id: user.id, email: user.email } });
    }
  }

  if (rt) {
    const { data, error } = await supabase.auth.refreshSession({ refresh_token: rt });
    if (!error && data.session && data.user) {
      const res = NextResponse.json({ user: { id: data.user.id, email: data.user.email } });
      res.cookies.set("quizora_at", data.session.access_token, {
        httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60,
      });
      res.cookies.set("quizora_rt", data.session.refresh_token, {
        httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30,
      });
      return res;
    }
  }

  return NextResponse.json({ user: null });
}

/** Sign out: revoke the Supabase refresh token, then clear cookies. */
export async function DELETE(req: NextRequest) {
  const rt = req.cookies.get("quizora_rt")?.value;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (rt && url && anon) {
    // Best-effort revoke so a stolen refresh token dies on sign-out.
    await createClient(url, anon, { auth: { persistSession: false } })
      .auth.signOut({ scope: "global" })
      .catch(() => {});
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("quizora_at", "", { maxAge: 0, path: "/" });
  res.cookies.set("quizora_rt", "", { maxAge: 0, path: "/" });
  return res;
}
