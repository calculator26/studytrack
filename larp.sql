-- =========================================================================
--  LARP REPORTS — banter, not moderation
--  -----------------------------------------------------------------------
--  "Larp" is what the year group calls faking your hours. Everybody gets one
--  report a day to spend on somebody they think is larping. Five reports on
--  one person in a day and a LARP ALERT drops into chat with their numbers,
--  and the room votes: legit or larp. Nothing happens either way. Nobody's
--  hours are touched, nothing is hidden, nobody is flagged anywhere real.
--
--  THE RULES, AND WHERE EACH ONE IS ENFORCED
--  All of them are in report_larp() below, because the anon key is public and
--  a rule the browser keeps is a rule anybody can skip.
--
--    * one report per person per day (Sydney), whoever it is spent on —
--      also a unique index, so two taps at once cannot both land
--    * never yourself
--    * never somebody in private mode: an alert would put their hours in chat
--    * only somebody with 4 hours or more today, running session counted in.
--      A larp accusation should always mean "you have been going suspiciously
--      hard", never announce to the year group that somebody did 20 minutes
--    * one alert per person per day, on the fifth report
--    * votes are one each, changeable, and close two hours after the alert
--
--  WHO REPORTED IS NOT A SECRET
--  Reports are readable by every member, reporter included. The app shows who
--  on hover over the count, and never says it in chat.
--
--  NOT ON THE COHORT VIEW
--  None of this is exposed to the anon key, and nothing in view.sql reads it.
--
--  Safe to re-run.
-- =========================================================================

create table if not exists public.larp_reports (
  id          bigserial primary key,
  reporter    uuid not null references auth.users on delete cascade,
  target      uuid not null references auth.users on delete cascade,
  day         date not null default (now() at time zone 'Australia/Sydney')::date,
  created_at  timestamptz not null default now()
);
-- the one-a-day rule, held by the database itself
create unique index if not exists larp_reports_one_a_day on public.larp_reports (reporter, day);
create index if not exists larp_reports_target_day on public.larp_reports (target, day);

create table if not exists public.larp_trials (
  id             uuid primary key default gen_random_uuid(),
  target         uuid not null references auth.users on delete cascade,
  day            date not null,
  created_at     timestamptz not null default now(),
  closes_at      timestamptz not null default now() + interval '2 hours',
  -- the numbers as they stood when the fifth report landed, so the alert
  -- still reads the same tomorrow
  today_minutes  int not null,
  week_minutes   int not null,
  week_rank      int,
  week_of        int
);
create unique index if not exists larp_trials_one_a_day on public.larp_trials (target, day);

create table if not exists public.larp_votes (
  trial_id    uuid not null references public.larp_trials on delete cascade,
  user_id     uuid not null references auth.users on delete cascade,
  vote        text not null check (vote in ('legit', 'larp')),
  created_at  timestamptz not null default now(),
  primary key (trial_id, user_id)
);

-- The chat message that carries an alert points at its trial.
alter table public.messages add column if not exists larp_trial uuid references public.larp_trials on delete set null;

alter table public.larp_reports enable row level security;
alter table public.larp_trials  enable row level security;
alter table public.larp_votes   enable row level security;

drop policy if exists "read all" on public.larp_reports;
drop policy if exists "read all" on public.larp_trials;
drop policy if exists "read all" on public.larp_votes;
create policy "read all" on public.larp_reports for select to authenticated using (true);
create policy "read all" on public.larp_trials  for select to authenticated using (true);
create policy "read all" on public.larp_votes   for select to authenticated using (true);
-- no insert, update or delete policies: everything goes through the functions
revoke all on public.larp_reports, public.larp_trials, public.larp_votes from anon;
revoke insert, update, delete on public.larp_reports, public.larp_trials, public.larp_votes from authenticated;

-- The accused cannot quietly delete their own trial from the room. An
-- administrator still can, the same as any other message.
drop policy if exists "delete own" on public.messages;
create policy "delete own" on public.messages
  for delete to authenticated
  using ((user_id = auth.uid() and larp_trial is null) or public.is_admin());

-- ------------------------------------------------------------------------
--  Somebody's minutes today, running session counted in — the same rule the
--  app uses for "studied today", so the 4 hour line is the number they see.
-- ------------------------------------------------------------------------
create or replace function public.larp_minutes_today(uid uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select (
    coalesce((select sum(minutes) from public.sessions
               where user_id = uid and day = (now() at time zone 'Australia/Sydney')::date), 0)
    + coalesce((select least(6 * 60,   -- a timer pauses itself at six hours
                  (t.acc_ms + case when t.running
                     then extract(epoch from now() - t.started_at) * 1000 else 0 end) / 60000)
                  from public.live_timers t
                 where t.user_id = uid
                   and t.updated_at > now() - case when t.running then interval '5 minutes'
                                                                  else interval '30 minutes' end), 0)
  )::int
$$;
revoke execute on function public.larp_minutes_today(uuid) from public, anon, authenticated;

-- ------------------------------------------------------------------------
--  Spend your report for the day.
-- ------------------------------------------------------------------------
create or replace function public.report_larp(target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  me       uuid := auth.uid();
  today    date := (now() at time zone 'Australia/Sydney')::date;
  spent    uuid;
  mins     int;
  n        int;
  week     int;
  rnk      int;
  outof    int;
  tid      uuid;
  who      text;
  txt      text;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'why', 'You are not signed in');
  end if;
  if target = me then
    return jsonb_build_object('ok', false, 'why', 'You cannot report yourself. Nice try');
  end if;
  select display_name into who from public.profiles where id = target and not hide_hours;
  if who is null then
    return jsonb_build_object('ok', false, 'why', 'They are in private mode, so they cannot be reported');
  end if;

  select r.target into spent from public.larp_reports r where r.reporter = me and r.day = today;
  if spent is not null then
    return jsonb_build_object('ok', false, 'why',
      case when spent = target then 'You have already reported them today'
           else 'You have used your report for today' end);
  end if;

  mins := public.larp_minutes_today(target);
  if mins < 240 then
    return jsonb_build_object('ok', false, 'why',
      who || ' needs 4 hours today before anyone can call it larp. They are on ' ||
      (mins / 60) || 'h ' || lpad((mins % 60)::text, 2, '0') || 'm');
  end if;

  begin
    insert into public.larp_reports (reporter, target, day) values (me, target, today);
  exception when unique_violation then
    return jsonb_build_object('ok', false, 'why', 'You have used your report for today');
  end;

  select count(*) into n from public.larp_reports r where r.target = report_larp.target and r.day = today;

  -- The fifth report calls the trial. Only once a day per person: a sixth
  -- report still counts, it just does not start another one.
  if n >= 5 and not exists (select 1 from public.larp_trials t where t.target = report_larp.target and t.day = today) then
    with wk as (
      select p.id,
             coalesce((select sum(s.minutes) from public.sessions s
                        where s.user_id = p.id and s.day > today - 7 and s.day < today), 0)
             + public.larp_minutes_today(p.id) as m
        from public.profiles p
       where not p.hide_hours
    ),
    ranked as (select id, m, rank() over (order by m desc) as r from wk where m > 0)
    select (select m from wk where id = report_larp.target),
           (select r from ranked where id = report_larp.target),
           (select count(*) from ranked)
      into week, rnk, outof;

    begin
      insert into public.larp_trials (target, day, today_minutes, week_minutes, week_rank, week_of)
      values (target, today, mins, coalesce(week, mins), rnk, outof)
      returning id into tid;
    exception when unique_violation then
      tid := null;                     -- a simultaneous fifth report got there first
    end;

    if tid is not null then
      -- The row's text is only what a client that knows nothing about trials
      -- would show. The app draws the card from the trial itself.
      txt := 'LARP ALERT: ' || n || ' people think ' || who || ' is larping. ' ||
             'Studied ' || (mins / 60) || 'h ' || lpad((mins % 60)::text, 2, '0') || 'm today and ' ||
             round(coalesce(week, mins) / 60.0, 1) || 'h this week. Legit or larp?';
      insert into public.messages (user_id, body, mentions, larp_trial)
      values (target, left(txt, 500), array[target], tid);
    end if;
  end if;

  return jsonb_build_object('ok', true, 'count', n, 'trial', tid);
end $fn$;

revoke execute on function public.report_larp(uuid) from public, anon;
grant  execute on function public.report_larp(uuid) to authenticated;

-- ------------------------------------------------------------------------
--  Legit or larp. One vote each, changeable until the trial closes. The
--  accused may vote too — they will vote legit, and that is funny as well.
--  Pressing the vote you already have takes it back.
-- ------------------------------------------------------------------------
create or replace function public.vote_larp(trial uuid, vote text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  me   uuid := auth.uid();
  t    public.larp_trials;
  had  text;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'why', 'You are not signed in');
  end if;
  if vote not in ('legit', 'larp') then
    return jsonb_build_object('ok', false, 'why', 'Legit or larp, nothing else');
  end if;
  select * into t from public.larp_trials where id = trial;
  if t.id is null then
    return jsonb_build_object('ok', false, 'why', 'That trial is gone');
  end if;
  if now() >= t.closes_at then
    return jsonb_build_object('ok', false, 'why', 'Voting has closed. The verdict stands');
  end if;

  select v.vote into had from public.larp_votes v where v.trial_id = trial and v.user_id = me;
  if had = vote_larp.vote then
    delete from public.larp_votes v where v.trial_id = trial and v.user_id = me;
    return jsonb_build_object('ok', true, 'vote', null);
  end if;
  insert into public.larp_votes (trial_id, user_id, vote) values (trial, me, vote_larp.vote)
  on conflict (trial_id, user_id) do update set vote = excluded.vote, created_at = now();
  return jsonb_build_object('ok', true, 'vote', vote_larp.vote);
end $fn$;

revoke execute on function public.vote_larp(uuid, text) from public, anon;
grant  execute on function public.vote_larp(uuid, text) to authenticated;

-- So a report, a vote and an alert land in everybody's open tab straight away.
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.larp_reports'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.larp_votes';   exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.larp_trials';  exception when others then null; end;
end $$;

notify pgrst, 'reload schema';
