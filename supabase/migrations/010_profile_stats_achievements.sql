-- 010_profile_stats_achievements.sql
-- Profile stats, ELO rating, game history, achievement system.
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- profiles: rating + streak + play-tracking columns
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists rating integer not null default 1000;
alter table public.profiles add column if not exists avg_answer_ms integer;
alter table public.profiles add column if not exists current_streak integer not null default 0;
alter table public.profiles add column if not exists last_played_at timestamptz;
alter table public.profiles add column if not exists avatar_preset text;

-- ---------------------------------------------------------------------------
-- player_category_stats: per-category aggregates
-- ---------------------------------------------------------------------------
create table if not exists public.player_category_stats (
  user_id uuid not null references public.profiles(id) on delete cascade,
  category text not null,
  games integer not null default 0,
  wins integer not null default 0,
  correct integer not null default 0,
  total integer not null default 0,
  best_streak integer not null default 0,
  primary key (user_id, category)
);

-- ---------------------------------------------------------------------------
-- game_results: one row per finished game per human player
-- ---------------------------------------------------------------------------
create table if not exists public.game_results (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  display_name text not null,
  opponent_name text,
  is_win boolean not null default false,
  is_draw boolean not null default false,
  score integer not null default 0,
  opponent_score integer not null default 0,
  correct integer not null default 0,
  total_questions integer not null default 0,
  avg_answer_ms integer,
  best_streak integer not null default 0,
  correct_streak_max integer not null default 0,
  fast_answers integer not null default 0,      -- answers under 3000 ms
  comeback boolean not null default false,      -- won after trailing >=60% of winner's final score
  mode text not null default '1v1' check (mode in ('1v1','tournament')),
  created_at timestamptz not null default now()
);
create index if not exists game_results_user_created_idx on public.game_results (user_id, created_at desc);
create index if not exists game_results_game_idx on public.game_results (game_id);
create unique index if not exists game_results_game_user_uniq on public.game_results (game_id, user_id);

-- ---------------------------------------------------------------------------
-- achievement_catalog + profile_achievements
-- ---------------------------------------------------------------------------
create table if not exists public.achievement_catalog (
  id text primary key,
  name text not null,
  description text not null,
  tier text not null check (tier in ('bronze','silver','gold','epic')),
  group_name text not null,
  icon_slug text not null
);

insert into public.achievement_catalog (id, name, description, tier, group_name, icon_slug) values
  ('first_steps',   'First Steps',    'Play your first game',                       'bronze', 'onboarding', 'first_steps'),
  ('opening_win',   'Opening Win',    'Win your first 1v1',                         'bronze', 'onboarding', 'opening_win'),
  ('perfect_start', 'Perfect Start',  'Win your first tournament match',            'silver', 'onboarding', 'perfect_start'),
  ('full_deck',     'Full Deck',      'Play a game in every category',              'gold',   'onboarding', 'full_deck'),
  ('regular',       'Regular',        'Play 10 games',                              'bronze', 'volume',     'regular'),
  ('veteran',       'Veteran',        'Play 100 games',                             'silver', 'volume',     'veteran'),
  ('century_club',  'Century Club',   'Play 500 games',                             'gold',   'volume',     'century_club'),
  ('marathoner',    'Marathoner',     'Answer 5,000 questions total',               'silver', 'volume',     'marathoner'),
  ('flawless',      'Flawless',       'Win a game 100% correct',                    'silver', 'performance','flawless'),
  ('hot_streak',    'Hot Streak',     '10 correct answers in a row within one game','silver', 'performance','hot_streak'),
  ('untouchable',   'Untouchable',    'Win a game conceding zero points',           'gold',   'performance','untouchable'),
  ('sniper',        'Sniper',         'Win a game with avg answer time under 3.0s', 'gold',   'performance','sniper'),
  ('comeback_kid',  'Comeback Kid',   'Win after trailing by 60% of max score',     'gold',   'performance','comeback_kid'),
  ('specialist',    'Specialist',     '25 wins in one category',                    'bronze', 'mastery',    'specialist'),
  ('scholar',       'Scholar',        '100 wins in one category',                   'silver', 'mastery',    'scholar'),
  ('grandmaster',   'Grandmaster',    '250 wins in one category',                   'gold',   'mastery',    'grandmaster'),
  ('polymath',      'Polymath',       'Win at least 5 games in all 10 categories',  'gold',   'mastery',    'polymath'),
  ('bracket_breaker','Bracket Breaker','Win your first tournament',                 'silver', 'social',     'bracket_breaker'),
  ('rival',         'Rival',          'Beat the same opponent 5 times',             'bronze', 'social',     'rival'),
  ('rematcher',     'Rematcher',      'Play 10 rematch games',                      'bronze', 'social',     'rematcher'),
  ('champion',      'Champion',       'Win 10 tournaments',                         'gold',   'social',     'champion'),
  ('mind_palace',   'Mind Palace',    'Win 3 consecutive games with zero wrong answers','epic','prestige',   'mind_palace'),
  ('lightning_god', 'Lightning God',  '50 correct answers under 2.0s in one day',   'epic',   'prestige',   'lightning_god'),
  ('immortal',      'Immortal',       'Reach a 30-day play streak',                 'epic',   'prestige',   'immortal')
on conflict (id) do nothing;

create table if not exists public.profile_achievements (
  user_id uuid not null references public.profiles(id) on delete cascade,
  achievement_id text not null references public.achievement_catalog(id) on delete cascade,
  unlocked_at timestamptz not null default now(),
  progress integer not null default 100,
  primary key (user_id, achievement_id)
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.player_category_stats enable row level security;
alter table public.game_results enable row level security;
alter table public.achievement_catalog enable row level security;
alter table public.profile_achievements enable row level security;

drop policy if exists pcs_public_read on public.player_category_stats;
create policy pcs_public_read on public.player_category_stats
  for select to anon, authenticated using (true);

drop policy if exists game_results_public_read on public.game_results;
create policy game_results_public_read on public.game_results
  for select to anon, authenticated using (true);

drop policy if exists catalog_public_read on public.achievement_catalog;
create policy catalog_public_read on public.achievement_catalog
  for select to anon, authenticated using (true);

drop policy if exists pa_public_read on public.profile_achievements;
create policy pa_public_read on public.profile_achievements
  for select to anon, authenticated using (true);

-- profiles: keep public read; self-update restricted to identity fields via
-- column-level grant (service role bypasses RLS for stats writes).
drop policy if exists profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

revoke update on public.profiles from authenticated;
grant update (username, avatar_url, avatar_preset) on public.profiles to authenticated;
grant select on public.profiles to authenticated;
grant select on public.game_results, public.player_category_stats,
  public.achievement_catalog, public.profile_achievements to authenticated, anon;

-- Tournament championships counter (incremented by tournament.ts on crown)
alter table public.profiles add column if not exists tournaments_won integer not null default 0;
