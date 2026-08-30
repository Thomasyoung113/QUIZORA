-- Player reports for question quality issues.
-- Writes go through the server (service role); clients get no direct access.
create table if not exists public.question_reports (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.questions(id) on delete cascade,
  game_id uuid references public.games(id) on delete set null,
  player_id uuid references public.room_players(id) on delete set null,
  reason text not null check(reason in ('wrong_answer','unclear','typo','inappropriate','other')),
  details text,
  status text not null default 'open' check(status in ('open','resolved','dismissed')),
  created_at timestamptz not null default now()
);

create index if not exists question_reports_question_idx on public.question_reports(question_id);
create index if not exists question_reports_status_idx on public.question_reports(status);

alter table public.question_reports enable row level security;
