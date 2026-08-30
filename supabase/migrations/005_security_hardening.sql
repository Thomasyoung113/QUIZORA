-- Security hardening:
-- 1. Answers are insert-only: unique constraint on (game_question_id, player_id)
--    rejects a second/rewritten answer at the DB level.
-- 2. RLS on room_players: clients can't update scores or other players' rows.
--    All game writes go through the server (service role), which bypasses RLS.

-- Insert-only answers (upsert was previously allowed by onConflict)
create unique index if not exists answers_one_per_player
  on public.answers (game_question_id, player_id);

alter table public.room_players enable row level security;

-- Clients may read players in their rooms (needed for lobby lists).
drop policy if exists "players readable" on public.room_players;
create policy "players readable" on public.room_players
  for select using (true);

-- No INSERT/UPDATE/DELETE policies for anon/authenticated on room_players:
-- joins and score writes happen server-side via the service role key.
