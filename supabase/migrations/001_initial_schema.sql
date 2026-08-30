create extension if not exists pgcrypto;

create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 username text not null unique,
 avatar_url text,
 xp integer not null default 0,
 total_games integer not null default 0,
 total_wins integer not null default 0,
 total_questions integer not null default 0,
 correct_answers integer not null default 0,
 best_streak integer not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.rooms (
 id uuid primary key default gen_random_uuid(),
 room_code text not null unique,
 host_id uuid references auth.users(id) on delete set null,
 status text not null default 'lobby' check(status in ('lobby','starting','in_game','finished','expired')),
 max_players integer not null default 5 check(max_players between 1 and 5),
 created_at timestamptz not null default now(),
 started_at timestamptz,
 ended_at timestamptz
);

create table if not exists public.room_players (
 id uuid primary key default gen_random_uuid(),
 room_id uuid not null references public.rooms(id) on delete cascade,
 user_id uuid references auth.users(id) on delete set null,
 guest_token_hash text,
 display_name text not null,
 is_host boolean not null default false,
 is_ready boolean not null default false,
 connected boolean not null default true,
 joined_at timestamptz not null default now(),
 left_at timestamptz,
 unique(room_id,user_id)
);

create table if not exists public.games (
 id uuid primary key default gen_random_uuid(),
 room_id uuid not null references public.rooms(id) on delete cascade,
 game_mode text not null default 'classic',
 difficulty text not null default 'medium',
 categories text[] not null,
 timer_seconds integer not null default 15 check(timer_seconds in (5,10,15,30,60)),
 total_rounds integer not null default 10 check(total_rounds between 1 and 100),
 current_round integer not null default 0,
 status text not null default 'pending' check(status in ('pending','active','finished','cancelled')),
 created_at timestamptz not null default now(),
 started_at timestamptz,
 ended_at timestamptz
);

create table if not exists public.questions (
 id uuid primary key default gen_random_uuid(),
 question text not null,
 category text not null,
 subcategory text,
 difficulty text not null check(difficulty in ('easy','medium','hard')),
 type text not null default 'multiple_choice',
 options jsonb not null,
 correct_option text not null check(correct_option in ('A','B','C','D')),
 explanation text not null,
 source text,
 source_url text,
 license text,
 status text not null default 'draft' check(status in ('draft','review','approved','retired')),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);

create table if not exists public.game_questions (
 id uuid primary key default gen_random_uuid(),
 game_id uuid not null references public.games(id) on delete cascade,
 round_number integer not null,
 question_id uuid not null references public.questions(id),
 started_at timestamptz,
 deadline_at timestamptz,
 closed_at timestamptz,
 unique(game_id,round_number),
 unique(game_id,question_id)
);

create table if not exists public.answers (
 id uuid primary key default gen_random_uuid(),
 game_question_id uuid not null references public.game_questions(id) on delete cascade,
 player_id uuid not null references public.room_players(id) on delete cascade,
 option text not null check(option in ('A','B','C','D')),
 submitted_at timestamptz not null default now(),
 response_ms integer,
 is_correct boolean,
 points integer not null default 0,
 unique(game_question_id,player_id)
);

create index if not exists rooms_code_idx on public.rooms(room_code);
create index if not exists room_players_room_idx on public.room_players(room_id);
create index if not exists games_room_idx on public.games(room_id);
create index if not exists game_questions_game_round_idx on public.game_questions(game_id,round_number);
create index if not exists answers_question_player_idx on public.answers(game_question_id,player_id);
create index if not exists questions_filter_idx on public.questions(status,category,difficulty);

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_players enable row level security;
alter table public.games enable row level security;
alter table public.questions enable row level security;
alter table public.game_questions enable row level security;
alter table public.answers enable row level security;

-- Final RLS policies must use the chosen guest-session strategy.
-- Never ship permissive production policies such as allow-all.
