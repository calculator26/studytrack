-- =========================================================================
--  STATS — the numbers behind the study clock, the subject battle, the
--  kudos board and achievements
--  -----------------------------------------------------------------------
--  All read-only. Safe to re-run.
--
--  WHERE THE TIME OF DAY COMES FROM
--  A session row knows when it was logged (created_at) and how long it was
--  (minutes), so it covered the stretch ending at created_at. Each session
--  is spread across the clock hours that stretch touches. For a timed
--  session that is exact to the minute; one added by hand lands where it
--  was typed in, which is usually right after the work.
--
--  The live-timer record (study_spans) is more precise, but it is readable
--  only by its owner, on purpose. Sessions are what members already see.
--
--  PRIVACY
--  crew_clock and crew_subject_hours run as the caller, so the row level
--  policy on sessions already leaves out anybody with hide_hours on.
--  kudos_board and badge_stats are security definer (reactions are not
--  readable directly), so they filter hide_hours themselves.
-- =========================================================================

-- When the peloton studies: minutes in each (weekday, hour), Monday = 0,
-- Sydney time, plus how many student-days that covers, so the page can show
-- "the typical student" instead of a total that only grows.
create or replace function public.crew_clock(since date)
returns jsonb
language sql
stable
set search_path = public
as $$
  with s as (
    select user_id, day, minutes, created_at
      from public.sessions
     where day >= since and minutes between 1 and 600
       /* a session typed in days later says nothing about the time of day */
       and ((created_at at time zone 'Australia/Sydney')::date - day) between 0 and 1
  ),
  spread as (
    select extract(isodow from h at time zone 'Australia/Sydney')::int - 1 as dow,
           extract(hour   from h at time zone 'Australia/Sydney')::int     as hr,
           extract(epoch from least(h + interval '1 hour', s.created_at)
                            - greatest(h, s.created_at - make_interval(mins => s.minutes))) / 60 as m
      from s,
           generate_series(date_trunc('hour', s.created_at - make_interval(mins => s.minutes)),
                           date_trunc('hour', s.created_at - interval '1 second'),
                           interval '1 hour') h
  ),
  sd as (select distinct user_id, day from s)
  select jsonb_build_object(
    'cells', coalesce((select jsonb_agg(jsonb_build_array(dow, hr, round(sum_m)::int))
                         from (select dow, hr, sum(m) sum_m from spread where m > 0 group by 1, 2) x), '[]'::jsonb),
    'student_days', (select count(*) from sd),
    'student_days_by_dow', coalesce((select jsonb_object_agg(d, n)
                         from (select extract(isodow from day)::int - 1 d, count(*) n from sd group by 1) w), '{}'::jsonb)
  )
$$;

-- The subject battle: hours per subject since a date, matched on the
-- normalised name the way the leaderboard filter does it.
create or replace function public.crew_subject_hours(since date)
returns table (label text, minutes bigint, people int)
language sql
stable
set search_path = public
as $$
  select mode() within group (order by btrim(sub.name)),
         sum(s.minutes)::bigint,
         count(distinct s.user_id)::int
    from public.sessions s
    join public.subjects sub on sub.id = s.subject_id
   where s.day >= since
   group by lower(btrim(regexp_replace(sub.name, '\s+', ' ', 'g')))
   order by 2 desc
   limit 24
$$;

-- The kudos board: who got the most kudos since a date, and who gave the
-- most. Your own kudos on yourself do not count, and nobody in private mode
-- appears on either list.
create or replace function public.kudos_board(since date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with pub as (select id from public.profiles where not hide_hours),
  t0 as (select (since::timestamp at time zone 'Australia/Sydney') as at),
  rx as (
    select r.user_id as giver, s.user_id as receiver
      from public.session_reactions r
      join public.sessions s on s.id = r.session_id
     where r.kind = 'kudos' and r.created_at >= (select at from t0)
    union all
    select user_id, owner_id
      from public.timer_reactions
     where kind = 'kudos' and created_at >= (select at from t0)
  )
  select jsonb_build_object(
    'received', coalesce((select jsonb_agg(jsonb_build_array(id, n) order by n desc)
       from (select receiver id, count(*) n from rx
              where giver <> receiver and receiver in (select id from pub)
              group by 1 order by 2 desc limit 10) a), '[]'::jsonb),
    'given', coalesce((select jsonb_agg(jsonb_build_array(id, n) order by n desc)
       from (select giver id, count(*) n from rx
              where giver <> receiver and giver in (select id from pub)
              group by 1 order by 2 desc limit 10) b), '[]'::jsonb)
  )
$$;

-- The same board for either reaction: which = 'kudos' or 'sus'. The kudos
-- board above stays for anything still calling it.
create or replace function public.reaction_board(since date, which text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with pub as (select id from public.profiles where not hide_hours),
  t0 as (select (since::timestamp at time zone 'Australia/Sydney') as at),
  rx as (
    select r.user_id as giver, s.user_id as receiver
      from public.session_reactions r
      join public.sessions s on s.id = r.session_id
     where r.kind = which and r.created_at >= (select at from t0)
    union all
    select user_id, owner_id
      from public.timer_reactions
     where kind = which and created_at >= (select at from t0)
  )
  select case when which not in ('kudos', 'sus') then null else jsonb_build_object(
    'received', coalesce((select jsonb_agg(jsonb_build_array(id, n) order by n desc)
       from (select receiver id, count(*) n from rx
              where giver <> receiver and receiver in (select id from pub)
              group by 1 order by 2 desc limit 10) a), '[]'::jsonb),
    'given', coalesce((select jsonb_agg(jsonb_build_array(id, n) order by n desc)
       from (select giver id, count(*) n from rx
              where giver <> receiver and giver in (select id from pub)
              group by 1 order by 2 desc limit 10) b), '[]'::jsonb)
  ) end
$$;

-- One person's kudos totals, for their achievements. Nothing for somebody in
-- private mode unless it is you asking about yourself.
create or replace function public.badge_stats(uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case
    when uid is null or (uid <> auth.uid()
                         and exists (select 1 from public.profiles where id = uid and hide_hours))
      then null
    else jsonb_build_object(
      'kudos_received',
        (select count(*) from public.session_reactions r join public.sessions s on s.id = r.session_id
          where s.user_id = uid and r.kind = 'kudos' and r.user_id <> uid)
      + (select count(*) from public.timer_reactions where owner_id = uid and kind = 'kudos' and user_id <> uid),
      'kudos_given',
        (select count(*) from public.session_reactions r join public.sessions s on s.id = r.session_id
          where r.user_id = uid and r.kind = 'kudos' and s.user_id <> uid)
      + (select count(*) from public.timer_reactions where user_id = uid and kind = 'kudos' and owner_id <> uid)
    )
  end
$$;

revoke execute on function public.crew_clock(date)         from public, anon;
revoke execute on function public.crew_subject_hours(date) from public, anon;
revoke execute on function public.kudos_board(date)        from public, anon;
revoke execute on function public.badge_stats(uuid)        from public, anon;
revoke execute on function public.reaction_board(date, text) from public, anon;
grant  execute on function public.crew_clock(date)         to authenticated;
grant  execute on function public.crew_subject_hours(date) to authenticated;
grant  execute on function public.kudos_board(date)        to authenticated;
grant  execute on function public.badge_stats(uuid)        to authenticated;
grant  execute on function public.reaction_board(date, text) to authenticated;

notify pgrst, 'reload schema';
