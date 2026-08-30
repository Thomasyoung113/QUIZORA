-- =============================================================================
-- 002_rls_policies.sql — BGHJS Row Level Security
--
-- THREAT MODEL
-- - The browser only ever holds the anon (publishable) key; all authoritative
--   game writes happen server-side in Next.js using the service-role key,
--   which bypasses RLS entirely.
-- - Guests have NO auth.users row: they are anonymous 'anon'-role clients.
--   Any policy granting to `authenticated` is irrelevant for guests; grants
--   below target `anon, authenticated` together since Realtime reads use anon.
-- - The questions table stores correct_option + explanation. If either leaked
--   to clients before reveal, the game is ruined. Column-level privileges
--   strip these columns from anon/authenticated entirely; the server fetches
--   them with the service role and only publishes them via Realtime payloads
--   after round close.
-- - Answers contain is_correct/points. Readable by all (needed at reveal),
--   but clients only learn correctness when the server broadcasts results;
--   rows only exist after submission, so nothing leaks pre-reveal.
-- - Everything writable (rooms, players, games, answers) is service-role
--   only: clients cannot forge scores, join full rooms, or mutate state.
-- - profiles are public-safe (username, avatar, aggregate stats); users can
--   update only their own row. No sensitive columns exist.
-- =============================================================================

create or replace function public.is_service_role()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(auth.jwt() ->> 'role', '') = 'service_role'
$$;

revoke execute on function public.is_service_role() from anon, authenticated;

-- -----------------------------------------------------------------------------
-- profiles: public read; user updates own row; inserts happen via trigger or
-- service role on signup.
-- -----------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to anon, authenticated using (true);

drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated using (id = auth.uid());

-- -----------------------------------------------------------------------------
-- rooms: readable by anyone holding/knowing the code (shared links);
-- writes service-role only (no policy = denied under RLS).
-- -----------------------------------------------------------------------------
drop policy if exists rooms_select on public.rooms;
create policy rooms_select on public.rooms
  for select to anon, authenticated using (true);

-- -----------------------------------------------------------------------------
-- room_players: lobby display needs full read; writes service-role only.
-- -----------------------------------------------------------------------------
drop policy if exists room_players_select on public.room_players;
create policy room_players_select on public.room_players
  for select to anon, authenticated using (true);

-- -----------------------------------------------------------------------------
-- games: game state is public within a room; writes service-role only.
-- -----------------------------------------------------------------------------
drop policy if exists games_select on public.games;
create policy games_select on public.games
  for select to anon, authenticated using (true);

-- -----------------------------------------------------------------------------
-- game_questions: holds no correct answers (question content lives in
-- questions); readable for round state/deadlines; writes service-role only.
-- -----------------------------------------------------------------------------
drop policy if exists game_questions_select on public.game_questions;
create policy game_questions_select on public.game_questions
  for select to anon, authenticated using (true);

-- -----------------------------------------------------------------------------
-- answers: NO client access. Pre-reveal rows contain players' option choices
-- and is_correct, which a client polling Supabase directly could read before
-- the server-gated reveal. RLS is static (not time-aware), so deny all client
-- access; results are served exclusively via /api/round, which strips answers
-- until closed_at is set. If Realtime on answers is wanted later, use a
-- security-invoker view filtered on closed_at. No policy = denied.
-- -----------------------------------------------------------------------------

-- -----------------------------------------------------------------------------
-- questions: the sensitive table.
-- 1) Row-level: only approved questions are visible to clients at all
--    (and even those without correct_option/explanation — see grants).
-- 2) Column-level: correct_option + explanation are revoked from
--    anon/authenticated at the table level, so no SELECT policy can expose
--    them. The server (service role) retains full access.
--    Caveat: Supabase client queries selecting `*` against questions will
--    ERROR on the revoked columns — the app must always select explicit
--    columns from questions. All game question delivery goes through the
--    server anyway, so this only matters for admin tooling.
-- -----------------------------------------------------------------------------
drop policy if exists questions_select_approved on public.questions;
create policy questions_select_approved on public.questions
  for select to anon, authenticated
  using (status = 'approved');

revoke select, insert, update, delete on public.questions from anon, authenticated;
grant select (id, question, category, subcategory, difficulty, type, options, status, created_at, updated_at) on public.questions to anon, authenticated;

-- -----------------------------------------------------------------------------
-- is_service_role helper: kept for defensive use in future policies.
-- -----------------------------------------------------------------------------
