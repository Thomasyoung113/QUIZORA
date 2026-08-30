-- Anti-cheat: forfeit markers for deliberate page-leave during a round.
alter table public.answers alter column option drop not null;
alter table public.answers drop constraint if exists answers_option_check;
alter table public.answers add constraint answers_option_check check (option is null or option in ('A','B','C','D'));
alter table public.answers add column if not exists forfeited boolean not null default false;

-- Clients get read-only access to answers; ALL writes (submit, forfeit,
-- scoring) happen server-side via the service role which bypasses RLS.
alter table public.answers enable row level security;
drop policy if exists "answers readable" on public.answers;
create policy "answers readable" on public.answers
  for select using (true);
