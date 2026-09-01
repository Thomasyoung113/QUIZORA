import { NextRequest } from "next/server";
import { serviceClient } from "@/lib/server/game";
import { clientIp, rateLimit } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
// Node runtime (edge is deprecated in Next 16). Vercel caps function wall
// time, so the stream self-terminates after STREAM_LIFETIME_MS and the
// browser's EventSource auto-reconnects — stateless SSE on serverless.
export const maxDuration = 60;

const STREAM_LIFETIME_MS = 25_000;
const POLL_INTERVAL_MS = 1_000;

function sse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Server-Sent Events stream for a room. Pushes a `state` event whenever the
 * room-state snapshot changes (players, game, scores, round transitions) and
 * a `closed` event when the room is closed. Replaces client polling.
 */
export async function GET(req: NextRequest) {
  if (!rateLimit(`sse:${clientIp(req)}`, 30, 60_000)) {
    return new Response("Too many requests", { status: 429 });
  }
  const code = req.nextUrl.searchParams.get("code")?.toUpperCase();
  if (!code) return new Response("Missing code", { status: 400 });

  const db = serviceClient();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const started = Date.now();
      let lastHash = "";
      let lastRoundHash = "";

      const push = (event: string, data: unknown) => {
        try {
          controller.enqueue(sse(event, data));
        } catch {
          // stream already closed
        }
      };

      const tick = async () => {
        const { data: room } = await db
          .from("rooms")
          .select("id, room_code, status, max_players, closed_at")
          .eq("room_code", code)
          .single();
        if (!room) {
          push("gone", { error: "Room not found" });
          return false;
        }
        if (room.status === "closed") {
          const closedAt = room.closed_at ? new Date(room.closed_at).getTime() : 0;
          if (Date.now() - closedAt > 30 * 60_000) {
            push("closed", { reason: "Room closed" });
            return false;
          }
        }

        // Room-state snapshot (same shape as /api/room-state)
        const [{ data: players }, { data: games }] = await Promise.all([
          db.from("room_players").select("id, display_name, is_host, is_ready, connected").eq("room_id", room.id).order("joined_at"),
          db.from("games").select("id, game_mode, difficulty, categories, timer_seconds, total_rounds, current_round, status").eq("room_id", room.id).order("created_at", { ascending: false }).limit(1),
        ]);
        const game = games?.[0] ?? null;
        const scores: Record<string, number> = {};
        if (game) {
          const { data: answers } = await db
            .from("answers")
            .select("player_id, points")
            .eq("game_id", game.id);
          for (const a of answers ?? []) {
            scores[a.player_id] = (scores[a.player_id] ?? 0) + (a.points ?? 0);
          }
        }
        const snapshot = { room, players: players ?? [], game, scores };
        const hash = JSON.stringify([snapshot.room, snapshot.players, snapshot.game, scores]);
        if (hash !== lastHash) {
          lastHash = hash;
          push("state", snapshot);
        }

        // Round transition events (round started / closed)
        if (game) {
          const { data: gq } = await db
            .from("game_questions")
            .select("round_number, started_at, deadline_at, closed_at")
            .eq("game_id", game.id)
            .not("started_at", "is", null)
            .order("round_number", { ascending: false })
            .limit(1)
            .maybeSingle();
          const roundHash = JSON.stringify(gq);
          if (gq && roundHash !== lastRoundHash) {
            lastRoundHash = roundHash;
            push("round", {
              round: gq.round_number,
              startedAt: gq.started_at,
              deadlineAt: gq.deadline_at,
              closedAt: gq.closed_at,
            });
          }
        }
        return true;
      };

      // Initial snapshot, then poll-push loop.
      const ok = await tick();
      if (!ok) {
        controller.close();
        return;
      }
      const interval = setInterval(async () => {
        if (Date.now() - started > STREAM_LIFETIME_MS) {
          clearInterval(interval);
          push("bye", { reconnect: true });
          controller.close();
          return;
        }
        try {
          const alive = await tick();
          if (!alive) {
            clearInterval(interval);
            controller.close();
          }
        } catch {
          // transient DB error: keep the stream open, next tick retries
        }
      }, POLL_INTERVAL_MS);

      // Abort when the client disconnects
      req.signal.addEventListener("abort", () => {
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          // already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
