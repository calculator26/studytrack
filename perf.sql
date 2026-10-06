-- =========================================================================
--  PERFORMANCE — row level policies that check who you are once per query
--  -----------------------------------------------------------------------
--  A policy written as  user_id = auth.uid() or is_admin()  calls both
--  functions again for every row it looks at. is_admin() reads auth.users
--  each time, so a read over six thousand sessions made twelve thousand
--  extra calls: crew_clock took 3.7 seconds, nearly all of it spent here.
--  Wrapped as  (select auth.uid())  and  (select public.is_admin())  each is
--  worked out once per query. Who can see and change what is unchanged.
--  Safe to re-run: a policy already wrapped is left alone.
-- =========================================================================
do $$
declare r record; nq text; nw text; stmt text;
begin
  for r in
    select tablename, policyname, qual, with_check from pg_policies
     where schemaname = 'public'
       and (coalesce(qual, '') ~ '(auth\.uid\(\)|is_admin\(\))' or coalesce(with_check, '') ~ '(auth\.uid\(\)|is_admin\(\))')
       and coalesce(qual, '') || coalesce(with_check, '') !~* 'select (auth\.uid|public\.is_admin|is_admin)\(\)'
  loop
    nq := regexp_replace(regexp_replace(r.qual, '(public\.)?is_admin\(\)', '(select public.is_admin())', 'g'), 'auth\.uid\(\)', '(select auth.uid())', 'g');
    nw := regexp_replace(regexp_replace(r.with_check, '(public\.)?is_admin\(\)', '(select public.is_admin())', 'g'), 'auth\.uid\(\)', '(select auth.uid())', 'g');
    stmt := format('alter policy %I on public.%I', r.policyname, r.tablename)
         || case when nq is not null then format(' using (%s)', nq) else '' end
         || case when nw is not null then format(' with check (%s)', nw) else '' end;
    execute stmt;
  end loop;
end $$;

-- =========================================================================
--  A SHARED CACHE FOR THE YEAR-GROUP STATS
--  crew_clock and reaction_board give everybody the same answer, so it is
--  worked out once and kept for a few minutes instead of once per person
--  per visit. Readable only through the functions below.
-- =========================================================================
create table if not exists public.stats_cache (
  key  text primary key,
  data jsonb not null,
  at   timestamptz not null default now()
);
alter table public.stats_cache enable row level security;
revoke all on public.stats_cache from anon, authenticated;

-- crew_clock as before, now run as its owner with private mode filtered out
-- explicitly (it used to lean on the sessions policy), and cached for 15
-- minutes. The busiest hour of the week does not move faster than that.
create or replace function public.crew_clock(since date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare k text := 'clock|' || since; res jsonb;
begin
  select data into res from public.stats_cache where key = k and at > now() - interval '15 minutes';
  if res is not null then return res; end if;
  with s as (
    select user_id, day, minutes, created_at
      from public.sessions
     where day >= since and minutes between 1 and 600
       and ((created_at at time zone 'Australia/Sydney')::date - day) between 0 and 1
       and user_id in (select id from public.profiles where not hide_hours)
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
  ) into res;
  insert into public.stats_cache (key, data, at) values (k, res, now())
    on conflict (key) do update set data = excluded.data, at = excluded.at;
  return res;
end $$;

-- reaction_board, cached for five minutes per range and reaction.
create or replace function public.reaction_board_live(since date, which text)
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
revoke execute on function public.reaction_board_live(date, text) from public, anon, authenticated;

create or replace function public.reaction_board(since date, which text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare k text := 'rx|' || since || '|' || which; res jsonb;
begin
  if which not in ('kudos', 'sus') then return null; end if;
  select data into res from public.stats_cache where key = k and at > now() - interval '5 minutes';
  if res is not null then return res; end if;
  res := public.reaction_board_live(since, which);
  insert into public.stats_cache (key, data, at) values (k, res, now())
    on conflict (key) do update set data = excluded.data, at = excluded.at;
  return res;
end $$;

revoke execute on function public.crew_clock(date) from public, anon;
grant  execute on function public.crew_clock(date) to authenticated;
revoke execute on function public.reaction_board(date, text) from public, anon;
grant  execute on function public.reaction_board(date, text) to authenticated;
notify pgrst, 'reload schema';

-- Indexes the advisor asked for on columns the boards and badges search by.
create index if not exists session_reactions_user_idx on public.session_reactions (user_id);
create index if not exists timer_reactions_user_idx   on public.timer_reactions (user_id);
create index if not exists message_reactions_user_idx on public.message_reactions (user_id);
create index if not exists sessions_area_idx          on public.sessions (area_id);
