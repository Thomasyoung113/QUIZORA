import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const schema = z.object({ email: z.string().email(), token: z.string().min(6).max(10) });

const SESSION_COOKIE = "quizora_session";
const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days

/**
 * Verifies the 6-digit email OTP, then issues our own opaque session cookie.
 * Session = sha256(user refresh-token-ish secret) stored server-verified via Supabase
 * session. We keep the Supabase refresh token in an httpOnly cookie directly.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid code" }, { status: 400 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.json({ error: "Auth not configured" }, { status: 500 });

  const supabase = createClient(url, anon, { auth: { persistSession: false } });
  const { data, error } = await supabase.auth.verifyOtp({
    email: parsed.data.email,
    token: parsed.data.token,
    type: "email",
  });
  if (error || !data.session || !data.user) return NextResponse.json({ error: "Wrong or expired code" }, { status: 401 });

  const res = NextResponse.json({
    ok: true,
    user: { id: data.user.id, email: data.user.email },
  });

  // Store the supabase access+refresh tokens in httpOnly cookies.
  // Access token short-lived; refresh token lets /api/auth/session renew.
  res.cookies.set("quizora_at", data.session.access_token, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 60 * 60,
  });
  res.cookies.set("quizora_rt", data.session.refresh_token, {
    httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: SESSION_TTL,
  });
  return res;
}
