-- 009: Room close lifecycle
-- Host can close a room. The code is dead after a 30-minute grace window
-- (accidental close protection): room-state returns 410 once elapsed.

alter table public.rooms add column if not exists closed_at timestamptz;

-- Hard cleanup: fully delete rooms closed >30 min so codes can't resolve.
-- Run via cron/pg_cron or the app's cleanup endpoint.
create or replace function public.purge_closed_rooms()
returns void as $$
  delete from public.rooms
  where status = 'closed'
    and closed_at < now() - interval '30 minutes';
$$ language sql;
