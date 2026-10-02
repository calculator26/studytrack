-- =========================================================================
--  WHEN A SESSION ACTUALLY HAPPENED
--  -----------------------------------------------------------------------
--  A session is one row with a length and the moment it was saved, so the
--  "Your day" chart used to assume it ran non-stop right up to the save. Two
--  hours in the morning, a three hour break and half an hour in the evening
--  came out as one solid block in the evening.
--
--  runs is the list of stretches the clock was actually running, as
--  [[start, end], ...] in ISO time. The live timer keeps it as you go
--  (live_timers.runs holds the stretches already finished; the one under
--  way is started_at plus whatever acc_ms has not yet accounted for) and the
--  save copies the lot onto the session. A session typed in by hand has
--  none, and the charts fall back to the old guess for it.
--
--  The backfill at the bottom rebuilds runs for sessions saved before this
--  existed, from the record (study_spans and the pause/resume events).
--
--  Safe to re-run.
-- =========================================================================

alter table public.live_timers add column if not exists runs jsonb not null default '[]'::jsonb;
alter table public.sessions    add column if not exists runs jsonb;

-- Bounded, so a browser cannot park something enormous on a row.
alter table public.live_timers drop constraint if exists live_timers_runs_size;
alter table public.live_timers add  constraint live_timers_runs_size
  check (jsonb_typeof(runs) = 'array' and jsonb_array_length(runs) <= 60);
alter table public.sessions drop constraint if exists sessions_runs_size;
alter table public.sessions add  constraint sessions_runs_size
  check (runs is null or (jsonb_typeof(runs) = 'array' and jsonb_array_length(runs) <= 60));

-- The study clock follows the real stretches too. Where a session's minutes
-- were edited on save, each stretch is scaled so the total still matches.
create or replace function public.crew_clock(since date)
returns jsonb
language sql
stable
set search_path = public
as $$
  with s as (
    select id, user_id, day, minutes, created_at, runs
      from public.sessions
     where day >= since and minutes between 1 and 600
       /* a session typed in days later says nothing about the time of day */
       and ((created_at at time zone 'Australia/Sydney')::date - day) between 0 and 1
  ),
  r as (
    select s.id, (x->>0)::timestamptz a, (x->>1)::timestamptz b
      from s, jsonb_array_elements(case when jsonb_typeof(s.runs) = 'array' then s.runs else '[]'::jsonb end) x
     where jsonb_typeof(x) = 'array'
  ),
  rt as (select id, sum(extract(epoch from b - a)) / 60 tot from r where b > a group by id),
  iv as (
    select r.a, r.b, s.minutes / rt.tot k
      from r join rt on rt.id = r.id join s on s.id = r.id
     where r.b > r.a and rt.tot > 0
    union all
    select s.created_at - make_interval(mins => s.minutes), s.created_at, 1
      from s where not exists (select 1 from rt where rt.id = s.id)
  ),
  spread as (
    select extract(isodow from h at time zone 'Australia/Sydney')::int - 1 as dow,
           extract(hour   from h at time zone 'Australia/Sydney')::int     as hr,
           iv.k * extract(epoch from least(h + interval '1 hour', iv.b) - greatest(h, iv.a)) / 60 as m
      from iv,
           generate_series(date_trunc('hour', iv.a), date_trunc('hour', iv.b - interval '1 second'),
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

-- ---------------------------------------------------------------------------
--  BACKFILL from the record. For each timed session without runs:
--    * the span the save stopped is the one closed as 'stopped' within a few
--      minutes of the session being written;
--    * the spans before it in the same sitting are the 'restarted' ones, each
--      closed when the next began (a resume moves started_at, which closes one
--      span and opens the next);
--    * inside each span the clock ran from its start until a timer.pause, and
--      again from any timer.resume, until the span closed.
--  Only kept when the stretches add up to something near the minutes saved,
--  so a mismatched guess is left alone rather than drawn wrong.
-- ---------------------------------------------------------------------------
do $$
declare
  s     record;
  sp    public.study_spans;
  prev  public.study_spans;
  chain public.study_spans[];
  ev    record;
  rr  jsonb;
  open_at timestamptz;
  tot   numeric;
  i     int;
begin
  for s in
    select x.id, x.user_id, x.minutes, x.created_at from public.sessions x
     where x.runs is null and x.created_at >= (select min(started_at) from public.study_spans)
  loop
    select * into sp from public.study_spans
     where user_id = s.user_id and ended_why = 'stopped'
       and ended_at between s.created_at - interval '10 seconds' and s.created_at + interval '3 minutes'
     order by ended_at limit 1;
    if not found then continue; end if;

    chain := array[sp];
    for i in 1..60 loop
      select * into prev from public.study_spans
       where user_id = s.user_id and ended_why = 'restarted' and id <> sp.id
         and ended_at between sp.started_at - interval '2 minutes' and sp.started_at + interval '2 minutes'
         and started_at < sp.started_at
       order by abs(extract(epoch from ended_at - sp.started_at)) limit 1;
      exit when not found;
      chain := prev || chain;
      sp := prev;
    end loop;

    rr := '[]'::jsonb;
    foreach sp in array chain loop
      open_at := sp.started_at;
      for ev in
        select e.at, e.kind from public.events e
         where e.actor = s.user_id and e.kind in ('timer.pause', 'timer.resume')
           and e.at > sp.started_at and e.at <= sp.ended_at
         order by e.at
      loop
        if ev.kind = 'timer.pause' and open_at is not null then
          if ev.at > open_at then rr := rr || jsonb_build_array(jsonb_build_array(open_at, ev.at)); end if;
          open_at := null;
        elsif ev.kind = 'timer.resume' and open_at is null then
          open_at := ev.at;
        end if;
      end loop;
      if open_at is not null and sp.ended_at > open_at then
        rr := rr || jsonb_build_array(jsonb_build_array(open_at, sp.ended_at));
      end if;
    end loop;

    select coalesce(sum(extract(epoch from (x->>1)::timestamptz - (x->>0)::timestamptz)) / 60, 0)
      into tot from jsonb_array_elements(rr) x;
    if jsonb_array_length(rr) between 1 and 60 and tot between s.minutes * 0.5 and s.minutes * 1.6 then
      update public.sessions set runs = rr where id = s.id;
    end if;
  end loop;
end $$;
