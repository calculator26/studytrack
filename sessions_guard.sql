-- =========================================================================
--  SESSIONS GUARD: what the database will not take, whoever is asking
--  -----------------------------------------------------------------------
--  On 6 Oct 2026 one account scripted ~7,000 sessions of 24 hours each in
--  forty minutes, putting 167,000 fake hours in the totals. These rules stop
--  that at the door, whatever the client does:
--    * no session on a day that hasn't happened yet (a day of slack for
--      clocks and time zones);
--    * no day over 20 hours for one person (the busiest real day logged
--      so far was 17.8 h);
--    * no more than 60 sessions logged by one person in an hour (the most
--      anyone real has done is 13).
--
--  13 Oct 2026, the house rules (63 sessions over 8 h quarantined that day):
--    * one session is 8 hours at most;
--    * a day is 16 hours at most (replaces the 20);
--    * study can only be logged for the last 7 days. Admins can still fix
--      older sessions, and anyone can shorten or re-note an old one.
--  Each rule only bites when a write adds time or moves a session, so
--  trimming a session or fixing its note always works. The database owner
--  (SQL editor, no signed-in user) is exempt, so quarantined sessions can be
--  put back. app.js checks the same numbers first and says so plainly.
--
--  17 Oct 2026, no overlaps (70 double-saved copies quarantined on 13 Oct):
--    * two of your sessions can't cover the same time. runs says when a
--      session happened: the stretches off the timer, or the From and To a
--      block typed in by hand now has. A new one may not overlap anything
--      you already logged by more than a minute (slack for clocks and
--      rounding), so the same hour can't be backlogged twice, or on top of
--      what the timer recorded;
--    * every session needs its times. A new one, or one that gains time or
--      moves, has to say when it happened (runs); the hand-log form asks for
--      From and To, the timer always had them. A session from before, with
--      no times, can still be shortened or re-noted, and admins can still
--      fix one. (This replaced a same-save-twice check for timeless saves.)
--  Both only bite on writes that add time or move a session, like the rest:
--  37 older sessions already overlap one another, and trimming or re-noting
--  them still works.
--
--  30 Oct 2026, a file import can go back past 7 days (import_sessions.sql):
--    * the 7-day rule is skipped for rows that import_sessions() saves, and
--      only for those. Every other rule still applies to them, and a day
--      before 1 Jan 2024 is refused;
--    * every other write from more than 7 days back is still refused.
--  Safe to re-run.
-- =========================================================================
create index if not exists sessions_user_created_idx on public.sessions (user_id, created_at);

create or replace function public.trg_sessions_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Australia/Sydney')::date;
  day_total int;
  grows boolean;
  importing boolean;
  hit_a timestamptz;
  hit_b timestamptz;
begin
  /* true when this write adds time or moves the session */
  grows := tg_op = 'INSERT' or new.day is distinct from old.day
           or new.user_id is distinct from old.user_id or new.minutes > old.minutes;
  /* the database owner putting things back (SQL editor): no signed-in user */
  if auth.uid() is null then return new; end if;
  /* import_sessions() (import_sessions.sql) sets this for its own rows */
  importing := coalesce(current_setting('studytrack.importing', true), '') = 'on';

  if new.day > today + 1 then
    raise exception 'You can''t log study on a day that hasn''t happened yet' using errcode = 'check_violation';
  end if;

  if importing and grows and new.day < date '2024-01-01' then
    raise exception 'That date is too far back' using errcode = 'check_violation';
  end if;

  if grows and new.minutes > 480 then
    raise exception 'One session can be 8 hours at most' using errcode = 'check_violation';
  end if;

  if grows and new.day < today - 7 and not importing and not coalesce(public.is_admin(), false) then
    raise exception 'Study can only be logged for the last 7 days (back to %)', to_char(today - 7, 'Dy DD Mon')
      using errcode = 'check_violation';
  end if;

  if grows then
    select coalesce(sum(minutes), 0) into day_total
      from public.sessions
     where user_id = new.user_id and day = new.day
       and (tg_op = 'INSERT' or id <> new.id);
    if day_total + new.minutes > 960 then
      raise exception 'That would put % over 16 hours, the most one day can have', to_char(new.day, 'Dy DD Mon')
        using errcode = 'check_violation';
    end if;
  end if;

  /* no two sessions covering the same time */
  if grows and jsonb_typeof(new.runs) = 'array' then
    select (q->>0)::timestamptz, (q->>1)::timestamptz into hit_a, hit_b
      from public.sessions s,
           jsonb_array_elements(s.runs) q,
           jsonb_array_elements(new.runs) r
     where s.user_id = new.user_id and s.id <> new.id
       and s.day between new.day - 1 and new.day + 1
       and jsonb_typeof(s.runs) = 'array'
       and least((q->>1)::timestamptz, (r->>1)::timestamptz)
         - greatest((q->>0)::timestamptz, (r->>0)::timestamptz) > interval '1 minute'
     limit 1;
    if found then
      raise exception 'That overlaps a session you''ve already logged (% to %). Two sessions can''t cover the same time',
        to_char(hit_a at time zone 'Australia/Sydney', 'FMHH12:MIam Dy DD Mon'),
        to_char(hit_b at time zone 'Australia/Sydney', 'FMHH12:MIam')
        using errcode = 'check_violation';
    end if;
  end if;

  /* every session says when it happened, so none can overlap unseen */
  if grows and jsonb_typeof(new.runs) is distinct from 'array'
     and not (tg_op = 'UPDATE' and coalesce(public.is_admin(), false)) then
    raise exception 'A session needs a start and end time. Refresh the page, then log it with From and To'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' and (select count(*) from public.sessions
                            where user_id = new.user_id and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Too many sessions logged in the last hour' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists sessions_guard on public.sessions;
create trigger sessions_guard before insert or update on public.sessions
  for each row execute function public.trg_sessions_guard();

-- What was taken out, kept where only the database owner can see it.
create table if not exists public.sessions_quarantine as
  select s.*, now() as quarantined_at, ''::text as why from public.sessions s where false;
alter table public.sessions_quarantine enable row level security;
revoke all on public.sessions_quarantine from anon, authenticated;
