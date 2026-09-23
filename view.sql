-- =========================================================================
--  COHORT VIEW — the year group, read-only, with no account
--  -----------------------------------------------------------------------
--  view/ in the site renders this. It exists for people who should be able
--  to follow how the cohort is going without joining — a teacher, most
--  obviously, who does not want students to feel watched in the app itself.
--
--  It is open: anybody with the address can load it. That is a choice, not
--  an oversight. Signing up is open too, and a member already sees all of
--  this and more, so a key on this page would protect nothing that is not
--  one sign-up away.
--
--  WHAT IT SHOWS
--  What a member sees on the Peloton tab and on somebody's profile: names,
--  hours, sessions, goals, streaks, subjects and areas, live timers, the
--  activity feed and how busy it gets.
--
--  WHAT IT NEVER SHOWS
--  Chat, session notes, nudges, reactions, marks (current_pct), emails and
--  avatars. And anybody with hide_hours on is not in any of it — not the
--  board, not the totals, not the live strip — exactly as for members.
--
--  Every function is security definer, because anon can read none of the
--  tables underneath, and each one filters hide_hours itself for the same
--  reason: row level security is not there to do it for them.
--
--  Safe to re-run.
-- =========================================================================

-- The first version handed out keyed links. Gone: the page no longer asks.
drop function if exists public.cohort_view(uuid);
drop function if exists public.cohort_seen(uuid);
drop table    if exists public.view_links;

-- ------------------------------------------------------------------------
--  Everything the page needs to draw itself once. Heavier than the poll
--  below, so the page reads it every few minutes rather than every thirty
--  seconds.
-- ------------------------------------------------------------------------
create or replace function public.cohort_view()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  with
  people as (
    select p.id, p.display_name, p.colour, p.default_goal, p.weekday_goals, p.created_at
      from public.profiles p
     where not p.hide_hours
  ),
  per_day as (
    select s.user_id, s.day, sum(s.minutes)::int as mins, count(*)::int as n
      from public.sessions s
      join people on people.id = s.user_id
     where s.day > (now() at time zone 'Australia/Sydney')::date - 400
     group by s.user_id, s.day
  ),
  daily as (
    select user_id, jsonb_object_agg(day::text, jsonb_build_array(mins, n)) as days
      from per_day group by user_id
  ),
  goals as (
    select g.user_id, g.day, g.hours
      from public.goals g
      join people on people.id = g.user_id
     where g.day > (now() at time zone 'Australia/Sydney')::date - 400
  ),
  subj_rows as (
    select s.id, s.user_id, btrim(s.name) as name,
           lower(btrim(regexp_replace(s.name, '\s+', ' ', 'g'))) as key
      from public.subjects s
      join people on people.id = s.user_id
  ),
  subj_mins as (
    select r.key,
           sum(x.minutes) filter (where x.day > (now() at time zone 'Australia/Sydney')::date - 7)::int as m7,
           sum(x.minutes)::int as mall
      from public.sessions x
      join subj_rows r on r.id = x.subject_id
     group by r.key
  ),
  subj as (
    select r.key,
           mode() within group (order by r.name) as label,
           array_agg(distinct r.user_id)         as takers,
           coalesce(max(m.m7), 0)                as m7,
           coalesce(max(m.mall), 0)              as mall
      from subj_rows r
      left join subj_mins m on m.key = r.key
     group by r.key
  )
  select jsonb_build_object(
    'now',      now(),
    'today',    (now() at time zone 'Australia/Sydney')::date,
    'people',   (select coalesce(jsonb_agg(people order by display_name), '[]') from people),
    'daily',    (select coalesce(jsonb_object_agg(user_id, days), '{}') from daily),
    'goals',    (select coalesce(jsonb_agg(goals), '[]') from goals),
    'subjects', (select coalesce(jsonb_agg(subj order by cardinality(takers) desc), '[]') from subj),
    'history',  (select coalesce(jsonb_agg(jsonb_build_array(bucket, peak) order by bucket), '[]')
                   from public.live_samples where bucket > now() - interval '30 days'),
    'record',   (select coalesce(max(peak), 0) from public.live_samples)
  )
$fn$;

-- ------------------------------------------------------------------------
--  What moves: who is on the clock, and the newest forty sessions. Small,
--  so the page can ask every thirty seconds.
--
--  Freshness is the app's own rule: a running timer must have checked in
--  within five minutes, a paused one is shown for half an hour after the
--  pause and then goes quiet.
-- ------------------------------------------------------------------------
create or replace function public.cohort_live()
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  with
  people as (select id from public.profiles where not hide_hours),
  live as (
    select t.user_id, t.running, t.started_at, t.acc_ms, t.label,
           sj.name as subject, sj.colour as subject_colour, ar.name as area
      from public.live_timers t
      join people on people.id = t.user_id
      left join public.subjects sj on sj.id = t.subject_id
      left join public.areas    ar on ar.id = t.area_id
     where t.updated_at > now() - case when t.running then interval '5 minutes'
                                                      else interval '30 minutes' end
  ),
  feed as (
    select s.id, s.user_id, s.day, s.minutes, s.created_at,
           sj.name as subject, sj.colour as subject_colour, ar.name as area
      from public.sessions s
      join people on people.id = s.user_id
      left join public.subjects sj on sj.id = s.subject_id
      left join public.areas    ar on ar.id = s.area_id
     order by s.created_at desc
     limit 40
  )
  select jsonb_build_object(
    'now',  now(),
    'live', (select coalesce(jsonb_agg(live), '[]') from live),
    'feed', (select coalesce(jsonb_agg(feed order by created_at desc), '[]') from feed)
  )
$fn$;

-- ------------------------------------------------------------------------
--  The board narrowed to one subject, matched on the normalised name the
--  same way crew_daily_by_subject() does it for members.
-- ------------------------------------------------------------------------
create or replace function public.cohort_subject_daily(subject_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  with per_day as (
    select s.user_id, s.day, sum(s.minutes)::int as mins, count(*)::int as n
      from public.sessions s
      join public.subjects sub on sub.id = s.subject_id
      join public.profiles p   on p.id = s.user_id and not p.hide_hours
     where lower(btrim(regexp_replace(sub.name, '\s+', ' ', 'g'))) = subject_key
       and s.day > (now() at time zone 'Australia/Sydney')::date - 400
     group by s.user_id, s.day
  ),
  daily as (
    select user_id, jsonb_object_agg(day::text, jsonb_build_array(mins, n)) as days
      from per_day group by user_id
  )
  select coalesce(jsonb_object_agg(user_id, days), '{}') from daily
$fn$;

-- ------------------------------------------------------------------------
--  One person's profile: their subjects, areas and every session, without
--  the notes. Nothing at all for somebody who has hidden their hours.
-- ------------------------------------------------------------------------
create or replace function public.cohort_profile(uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select case when not exists (select 1 from public.profiles where id = uid and not hide_hours)
    then null
    else jsonb_build_object(
      'subjects', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', id, 'name', name, 'colour', colour, 'exam_date', exam_date)
                     order by position, created_at), '[]')
                     from public.subjects where user_id = uid),
      'areas',    (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', id, 'subject_id', subject_id, 'name', name, 'target_hours', target_hours)
                     order by position), '[]')
                     from public.areas where user_id = uid),
      'sessions', (select coalesce(jsonb_agg(jsonb_build_object(
                     'id', id, 'day', day, 'minutes', minutes, 'subject_id', subject_id,
                     'area_id', area_id, 'created_at', created_at)
                     order by day desc, created_at desc), '[]')
                     from public.sessions where user_id = uid)
    )
  end
$fn$;

revoke execute on function public.cohort_view()                from public;
revoke execute on function public.cohort_live()                from public;
revoke execute on function public.cohort_subject_daily(text)   from public;
revoke execute on function public.cohort_profile(uuid)         from public;
grant  execute on function public.cohort_view()                to anon, authenticated;
grant  execute on function public.cohort_live()                to anon, authenticated;
grant  execute on function public.cohort_subject_daily(text)   to anon, authenticated;
grant  execute on function public.cohort_profile(uuid)         to anon, authenticated;

notify pgrst, 'reload schema';
