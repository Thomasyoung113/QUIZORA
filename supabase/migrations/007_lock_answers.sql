-- Answers table: NO client access at all.
-- All reads/writes happen server-side via the service role (bypasses RLS).
-- Migration 006 incorrectly added a "for select using (true)" policy; this
-- revokes it and removes the underlying grants entirely (RLS alone was not
-- enough because the permissive policy made every row visible to anon).

drop policy if exists "answers readable" on public.answers;

revoke all on public.answers from anon;
revoke all on public.answers from authenticated;

alter table public.answers enable row level security;
