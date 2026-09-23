-- =========================================================================
--  COHORT VIEW — a read-only window on the year group, with no account
--  -----------------------------------------------------------------------
--  view/ in the site renders this. It exists for people who should be able
--  to see how the cohort is going without joining — a teacher, most
--  obviously, who does not want students to feel watched in the app itself.
--
--  HOW THE DOOR WORKS
--  There is no login, so the link is the key. Each link carries a
--  random token after the # (never sent to GitHub, never in a referrer).
--  The page hands it to cohort_view(), which returns nothing unless the
--  token is in view_links and not revoked. Without a token, /view/ is an
--  empty page. Anyone can find the URL; nobody can guess a 122-bit token.
--
--  view_links has row level security on and no policies, so the anon and
--  authenticated keys can neither read nor write it. Tokens are made and
--  revoked here, in the SQL editor:
--
--    insert into public.view_links (label) values ('Shared link 2') returning token;
--    update public.view_links set revoked_at = now() where label = 'Shared link 1';
--
--  The label is only for you, here. The page never shows it.
--
--  WHAT IT SHOWS, AND WHAT IT NEVER DOES
--  Hours, sessions, subjects, the live strip and the top of the leaderboard:
--  the same things every student already sees on the Peloton page.
--  Never: chat, session notes, nudges, reactions, emails, marks, goals.
--  Anyone with hide_hours on is left out of every figure, the totals
--  included, exactly as they are for their classmates.
--
--  Safe to re-run.
-- =========================================================================

create table if not exists public.view_links (
  token       uuid primary key default gen_random_uuid(),
  label       text not null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz,
  last_seen   timestamptz
);
alter table public.view_links enable row level security;
revoke all on public.view_links from anon, authenticated;

create or replace function public.cohort_view(token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  today date := (now() at time zone 'Australia/Sydney')::date;
  out   jsonb;
begin
  if token is null or not exists (
       select 1 from public.view_links l
        where l.token = cohort_view.token and l.revoked_at is null) then
    return null;
  end if;

  with
  people as (
    select p.id, p.display_name as name, p.colour
      from public.profiles p
     where not p.hide_hours
  ),
  s as (
    select s.user_id, s.day, s.minutes, s.subject_id
      from public.sessions s
      join people on people.id = s.user_id
  ),
  per_day as (
    select d::date as day,
           coalesce(sum(s.minutes), 0)::int        as minutes,
           count(distinct s.user_id)::int          as students,
           count(s.user_id)::int                   as sessions
      from generate_series(today - 29, today, interval '1 day') d
      left join s on s.day = d::date
     group by d
     order by d
  ),
  subj as (
    select mode() within group (order by btrim(sub.name))           as label,
           sum(s.minutes) filter (where s.day > today - 7)::int     as m7,
           sum(s.minutes)::int                                      as mall,
           count(distinct s.user_id)::int                           as students
      from s
      join public.subjects sub on sub.id = s.subject_id
     group by lower(btrim(regexp_replace(sub.name, '\s+', ' ', 'g')))
  ),
  leaders as (
    select people.name, people.colour,
           sum(s.minutes) filter (where s.day > today - 7)::int        as m7,
           sum(s.minutes)::int                                         as mall,
           count(distinct s.day) filter (where s.day > today - 7)::int as days7
      from s join people on people.id = s.user_id
     group by people.id, people.name, people.colour
  ),
  live as (
    select people.name, people.colour, t.label, t.running, t.started_at, t.acc_ms
      from public.live_timers t
      join people on people.id = t.user_id
     where t.updated_at > now() - interval '5 minutes'
  ),
  by_hour as (
    select extract(hour from bucket at time zone 'Australia/Sydney')::int as hour,
           round(avg(peak), 1) as avg_peak, max(peak) as max_peak
      from public.live_samples
     where bucket > now() - interval '14 days'
     group by 1
  )
  select jsonb_build_object(
    'now',   now(),
    'today', today,
    'totals', jsonb_build_object(
      'members',       (select count(*) from people),
      'ever_studied',  (select count(distinct user_id) from s),
      'minutes_all',   (select coalesce(sum(minutes), 0) from s),
      'sessions_all',  (select count(*) from s),
      'minutes_7d',    (select coalesce(sum(minutes), 0) from s where day > today - 7),
      'minutes_prev7', (select coalesce(sum(minutes), 0) from s where day > today - 14 and day <= today - 7),
      'active_7d',     (select count(distinct user_id) from s where day > today - 7),
      'minutes_today', (select coalesce(sum(minutes), 0) from s where day = today),
      'active_today',  (select count(distinct user_id) from s where day = today),
      'first_day',     (select min(day) from s),
      'live_record',   (select coalesce(max(peak), 0) from public.live_samples)
    ),
    'daily',    (select coalesce(jsonb_agg(per_day), '[]') from per_day),
    'subjects', (select coalesce(jsonb_agg(x order by x.mall desc), '[]')
                   from (select * from subj where mall > 0 order by mall desc limit 16) x),
    'leaders',  (select coalesce(jsonb_agg(x order by x.m7 desc), '[]')
                   from (select * from leaders where m7 > 0 order by m7 desc limit 10) x),
    'live',     (select coalesce(jsonb_agg(live order by live.running desc, live.started_at), '[]') from live),
    'by_hour',  (select coalesce(jsonb_agg(by_hour order by hour), '[]') from by_hour)
  ) into out;

  return out;
end $fn$;

-- A separate, volatile function for "last seen", because cohort_view is
-- stable and is called every thirty seconds; one write per page load is plenty.
create or replace function public.cohort_seen(token uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.view_links set last_seen = now()
   where view_links.token = cohort_seen.token and revoked_at is null;
$$;

revoke execute on function public.cohort_view(uuid) from public;
revoke execute on function public.cohort_seen(uuid) from public;
grant  execute on function public.cohort_view(uuid) to anon, authenticated;
grant  execute on function public.cohort_seen(uuid) to anon, authenticated;

notify pgrst, 'reload schema';
