-- 008: Tournament bracket mode
-- Host creates a tournament (4/8/16 players), players join by code,
-- bracket service pairs them into matches. Each match = one existing
-- `games` row in a per-match room. Winners advance automatically.

create table if not exists public.tournaments (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,                    -- join code (6 chars, like rooms)
  host_id uuid not null references auth.users(id) on delete cascade,
  size integer not null check(size in (4, 8, 16)),
  status text not null default 'lobby'
    check(status in ('lobby','seeding','running','finished','cancelled')),
  game_mode text not null default 'classic',
  difficulty text not null default 'medium',
  categories text[] not null default '{General Knowledge}',
  timer_seconds integer not null default 15 check(timer_seconds in (5,10,15,30,60)),
  rounds_per_match integer not null default 5 check(rounds_per_match between 1 and 20),
  champion_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create table if not exists public.tournament_entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  seed integer,                                 -- bracket seed, set at start
  eliminated_in integer,                        -- bracket round number where eliminated
  joined_at timestamptz not null default now(),
  unique(tournament_id, user_id)
);

create table if not exists public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  bracket_round integer not null,               -- 1 = first round, grows to final
  match_slot integer not null,                  -- position within the round (1-based)
  game_id uuid references public.games(id) on delete set null,
  room_id uuid references public.rooms(id) on delete set null,
  player_a_id uuid references public.tournament_entries(id) on delete set null,
  player_b_id uuid references public.tournament_entries(id) on delete set null,
  winner_entry_id uuid references public.tournament_entries(id) on delete set null,
  status text not null default 'pending'
    check(status in ('pending','active','finished','walkover')),
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique(tournament_id, bracket_round, match_slot)
);

create index if not exists tournaments_code_idx on public.tournaments(code);
create index if not exists tournament_entries_tournament_idx on public.tournament_entries(tournament_id);
create index if not exists tournament_matches_tournament_idx on public.tournament_matches(tournament_id, bracket_round);

alter table public.tournaments enable row level security;
alter table public.tournament_entries enable row level security;
alter table public.tournament_matches enable row level security;

-- Clients may READ tournament state (bracket is public to participants),
-- but ALL writes go through the API with the service role.
create policy "tournaments readable" on public.tournaments for select using (true);
create policy "entries readable" on public.tournament_entries for select using (true);
create policy "matches readable" on public.tournament_matches for select using (true);
