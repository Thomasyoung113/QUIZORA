import { NextRequest } from "next/server";

/**
 * Tiny in-memory sliding-window rate limiter, keyed by bucket name + client id.
 * Per serverless-instance only (Vercel) — good enough to stop casual floods;
 * not a substitute for a shared store at high scale.
 */

type Window = { count: number; resetAt: number };
const buckets = new Map<string, Window>();

// Periodic cleanup so the map doesn't grow unbounded.
let lastSweep = Date.now();
function sweep() {
  const now = Date.now();
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [k, w] of buckets) if (w.resetAt < now) buckets.delete(k);
}

export function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-real-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    "unknown"
  );
}

/**
 * Returns true if allowed, false if rate-limited.
 * @param key     stable bucket id, e.g. `create-room:${ip}`
 * @param limit   max events per window
 * @param windowMs window length in ms
 */
export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  sweep();
  const now = Date.now();
  const w = buckets.get(key);
  if (!w || w.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (w.count >= limit) return false;
  w.count++;
  return true;
}

export function tooMany(res: ReturnType<typeof import("next/server").NextResponse.json>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = res as any;
  r.status = 429;
  return r;
}
