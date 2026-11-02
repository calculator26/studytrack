-- =========================================================================
--  HSC DONE LOCK: nothing logged for any time after your last paper
--  -----------------------------------------------------------------------
--  2 Nov 2026. exams_over.sql stops a subject once its own course's last
--  paper is over, but anything else (a hand-typed subject, "General study")
--  could still be logged afterwards. Once your whole HSC is over, nothing
--  can be: no session, under any subject, may have time after the moment
--  your last paper ends, to the minute.
--
--  That moment is profiles.hsc_done_at (hsc_done.sql), which your own app
--  keeps up to date from the same exam list as the countdown. app.js checks
--  the same thing first: it won't start a timer once you're done, and a
--  timer left running past your last paper saves only the part before it.
--  Members with no hsc_done_at are not held to anything.
--
--  Like sessions_guard.sql it only bites on writes that add time or move a
--  session; trimming or re-noting always works. The database owner (SQL
--  editor) and admins fixing a session are exempt. Run after hsc_done.sql.
--  Safe to re-run.
-- =========================================================================
create or replace function public.trg_sessions_hsc_done()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  done timestamptz;
  ended timestamptz;
begin
  /* the database owner putting things back (SQL editor): no signed-in user */
  if auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE' and coalesce(public.is_admin(), false) then return new; end if;
  /* trimming or re-noting is always fine */
  if tg_op = 'UPDATE' and new.day is not distinct from old.day and new.minutes <= old.minutes
     and new.user_id is not distinct from old.user_id then
    return new;
  end if;

  select hsc_done_at into done from public.profiles where id = new.user_id;
  if done is null then return new; end if;

  if jsonb_typeof(new.runs) = 'array' then
    select max((r->>1)::timestamptz) into ended from jsonb_array_elements(new.runs) r;
  end if;
  /* no times to go on (sessions_guard.sql refuses those anyway): the day it's on */
  if ended is null and new.day > (done at time zone 'Australia/Sydney')::date then
    ended := 'infinity';
  end if;

  if ended > done then
    raise exception 'Your last HSC exam finished on % at %, so nothing after that can be logged',
      to_char(done at time zone 'Australia/Sydney', 'Dy DD Mon'),
      lower(to_char(done at time zone 'Australia/Sydney', 'FMHH12:MIam'))
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists sessions_hsc_done on public.sessions;
create trigger sessions_hsc_done before insert or update on public.sessions
  for each row execute function public.trg_sessions_hsc_done();
