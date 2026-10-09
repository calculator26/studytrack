-- =========================================================================
--  DIAG — small reports from browsers when the app goes wrong (diag.js)
--  -----------------------------------------------------------------------
--  Written only through diag_report(); nobody can read it from the app.
--  Read it in the Supabase SQL editor, e.g.
--    select at, kind, data->>'detail', data from public.client_diag order by at desc limit 50;
--
--  Kept small on purpose, so it can never crowd the database or the plan:
--    · at most 5 reports an hour from any one person, 300 an hour in all
--    · never more than 5,000 rows, each under 4 KB (so ~20 MB at the very most)
--    · anything older than 14 days is deleted as new reports arrive
--  A normal visit sends nothing at all. Safe to re-run.
-- =========================================================================
create table if not exists public.client_diag (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete cascade,
  kind    text not null check (char_length(kind) <= 40),
  data    jsonb not null check (pg_column_size(data) <= 4096)
);
create index if not exists client_diag_at_idx   on public.client_diag (at);
create index if not exists client_diag_user_idx on public.client_diag (user_id, at);
alter table public.client_diag enable row level security;
-- no policies: the app can't read or write the table directly
revoke all on public.client_diag from anon, authenticated;

create or replace function public.diag_report(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  k text;
  d jsonb;
begin
  if me is null or p is null or jsonb_typeof(p) <> 'object' then
    return jsonb_build_object('ok', false);
  end if;
  if (select count(*) from public.client_diag where user_id = me and at > now() - interval '1 hour') >= 5
     or (select count(*) from public.client_diag where at > now() - interval '1 hour') >= 300 then
    return jsonb_build_object('ok', false, 'why', 'limited');
  end if;
  -- the keep: two weeks, and a hard ceiling on rows
  delete from public.client_diag where at < now() - interval '14 days';
  if (select count(*) from public.client_diag) >= 5000 then
    return jsonb_build_object('ok', false, 'why', 'full');
  end if;
  k := left(coalesce(p->>'kind', 'unknown'), 40);
  d := p - 'kind';
  if pg_column_size(d) > 4000 then
    d := jsonb_build_object('truncated', left(d::text, 900));
  end if;
  insert into public.client_diag (user_id, kind, data) values (me, k, d);
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.diag_report(jsonb) from public, anon;
grant  execute on function public.diag_report(jsonb) to authenticated;

notify pgrst, 'reload schema';
