-- OTDB questions have no explanations; make the column nullable.
alter table public.questions alter column explanation drop not null;
