-- =========================================================================
--  session_cap: a session can't be longer than its own times (27 Oct 2026)
--  -----------------------------------------------------------------------
--  Run after sessions_guard.sql. The overlap rule compares when sessions
--  happened (runs), but Minutes was free: stopping the timer after 52
--  seconds and saving 58 minutes passed, and the calendar, which drew
--  "saved minus minutes", showed it on top of the session before. Now a
--  write that adds time or moves a session may not claim more minutes than
--  its runs cover (two minutes slack for rounding and a split at midnight).
--  Less is fine: a break taken without pausing can still be taken off.
--  Admins fixing someone else's session, and the database owner, are exempt.
--
--  On the day it went in, every session already padded like that AND drawn
--  on top of another of the same person's was cut back to its real length.
--  What each was before is in session_trims (owner-only), so any of them
--  can be put back:
--      update public.sessions s set minutes = t.minutes_before
--        from public.session_trims t where t.session_id = s.id and s.id = '<uuid>';
--  Safe to re-run (the trim only touches sessions still padded).
-- =========================================================================
create or replace function public.session_runs_minutes(r jsonb)
returns numeric
language sql
immutable
as $$
  select coalesce(sum(extract(epoch from ((q->>1)::timestamptz - (q->>0)::timestamptz))) / 60, 0)
    from jsonb_array_elements(case when jsonb_typeof(r) = 'array' then r else '[]'::jsonb end) q
$$;

create or replace function public.trg_sessions_cap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  grows boolean;
  ran   int;
begin
  if auth.uid() is null then return new; end if;
  if jsonb_typeof(new.runs) is distinct from 'array' then return new; end if;
  grows := tg_op = 'INSERT' or new.day is distinct from old.day
           or new.minutes > old.minutes or new.runs is distinct from old.runs;
  if not grows then return new; end if;
  if tg_op = 'UPDATE' and new.user_id <> auth.uid() and coalesce(public.is_admin(), false) then return new; end if;
  ran := round(public.session_runs_minutes(new.runs));
  if new.minutes > ran + 2 then
    raise exception 'The timer ran for % min, so that''s the most this session can be. Log anything before it with From and To', ran
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke execute on function public.trg_sessions_cap() from public, anon, authenticated;

drop trigger if exists sessions_cap on public.sessions;
create trigger sessions_cap before insert or update on public.sessions
  for each row execute function public.trg_sessions_cap();

-- ---------- the one-off trim ----------
create table if not exists public.session_trims (
  session_id     uuid primary key,
  user_id        uuid not null,
  day            date not null,
  minutes_before int not null,
  minutes_after  int not null,
  trimmed_at     timestamptz not null default now()
);
alter table public.session_trims enable row level security;
revoke all on public.session_trims from anon, authenticated;

with x as (
  select s.id, s.user_id, s.day, s.minutes, s.created_at,
         round(public.session_runs_minutes(s.runs))::int span
    from public.sessions s where jsonb_typeof(s.runs) = 'array'
), d as (
  select *, created_at - make_interval(mins => minutes) da, minutes > span + 2 padded from x
), hit as (
  select distinct a.id
    from d a join d b on a.user_id = b.user_id and a.id <> b.id and a.padded
     and least(a.created_at, b.created_at) - greatest(a.da, b.da) > interval '1 minute'
), logged as (
  insert into public.session_trims (session_id, user_id, day, minutes_before, minutes_after)
  select d.id, d.user_id, d.day, d.minutes, greatest(d.span, 1) from d join hit using (id)
  on conflict (session_id) do nothing
  returning session_id, minutes_after
)
update public.sessions s set minutes = l.minutes_after
  from logged l where s.id = l.session_id;
