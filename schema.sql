-- ============================================================
--  STUDY CREW — Supabase schema
--  Paste this whole file into the Supabase SQL editor and run it.
--  Safe to re-run.
-- ============================================================

create extension if not exists "pgcrypto";

-- ---------- profiles -----------------------------------------------------
create table if not exists public.profiles (
  id             uuid primary key references auth.users on delete cascade,
  display_name   text not null default 'New member',
  avatar_url     text,
  school         text,
  colour         text not null default '#2FCFA6',
  default_goal   numeric not null default 3,
  weekday_goals  jsonb,                       -- [mon,tue,wed,thu,fri,sat,sun] hours, or null
  onboarded      boolean not null default false,
  created_at     timestamptz not null default now()
);

-- ---------- subjects -----------------------------------------------------
create table if not exists public.subjects (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  name       text not null,
  colour     text not null default '#3E7CA6',
  exam_date  date,
  position   int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists subjects_user_idx on public.subjects(user_id);

-- ---------- areas (modules / topics inside a subject) --------------------
create table if not exists public.areas (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users on delete cascade,
  subject_id   uuid not null references public.subjects on delete cascade,
  name         text not null,
  exam_date    date,          -- optional; falls back to the subject's date
  target_hours numeric,       -- optional planned hours
  current_pct  numeric,       -- optional: the mark you currently score here (0-100)
  position     int not null default 0
);
create index if not exists areas_user_idx on public.areas(user_id);
create index if not exists areas_subject_idx on public.areas(subject_id);

-- ---------- sessions -----------------------------------------------------
create table if not exists public.sessions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  subject_id uuid references public.subjects on delete set null,
  area_id    uuid references public.areas on delete set null,
  day        date not null,
  minutes    int  not null check (minutes > 0 and minutes <= 1440),
  mode       text,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists sessions_user_day_idx on public.sessions(user_id, day);
create index if not exists sessions_day_idx on public.sessions(day);

-- ---------- per-day goal overrides ---------------------------------------
create table if not exists public.goals (
  user_id uuid not null references auth.users on delete cascade,
  day     date not null,
  hours   numeric not null check (hours >= 0),
  primary key (user_id, day)
);

-- ---------- live timers (what makes the crew feel live) ------------------
create table if not exists public.live_timers (
  user_id    uuid primary key references auth.users on delete cascade,
  label      text,
  subject_id uuid,
  area_id    uuid,
  started_at timestamptz not null default now(),
  acc_ms     bigint not null default 0,
  running    boolean not null default true,
  updated_at timestamptz not null default now()
);

-- ============================================================
--  WHO IS AN ADMINISTRATOR
-- ------------------------------------------------------------
--  The single source of truth for the admin console. It is a
--  function rather than a table so that nothing reachable from the
--  browser can grant admin to anybody: the anon key cannot alter a
--  function definition, and the list below is only editable here,
--  in the SQL editor, by the project owner.
--
--  TO ADD OR REMOVE AN ADMIN: edit the array, re-run this file.
--
--  It reads auth.users rather than the JWT because a JWT can be
--  minted with whatever claims the caller likes; the users table
--  cannot. security definer is what lets it read auth.users at all,
--  and it is stable so the planner calls it once per statement
--  rather than once per row.
-- ============================================================
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1 from auth.users u
    where u.id = auth.uid()
      and lower(u.email) = any (array[
        'lchristie26@knox.nsw.edu.au',
        'akhannaboyle26@knox.nsw.edu.au'
      ])
  );
$$;

revoke all on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- ============================================================
--  ROW LEVEL SECURITY
--  Everyone signed in can READ everyone's data — that is the app.
--  Nobody can WRITE anything that is not theirs, with one exception:
--  an administrator may edit and delete anyone's rows, so that abuse
--  can actually be cleaned up. Admins still cannot INSERT rows in
--  somebody else's name — nothing about moderation needs that, and
--  leaving it out means no admin can fabricate a session for another
--  member.
-- ============================================================
alter table public.profiles    enable row level security;
alter table public.subjects    enable row level security;
alter table public.areas       enable row level security;
alter table public.sessions    enable row level security;
alter table public.goals       enable row level security;
alter table public.live_timers enable row level security;

do $$
declare t text;
begin
  foreach t in array array['profiles','subjects','areas','sessions','goals','live_timers'] loop
    execute format('drop policy if exists "read all" on public.%I', t);
    execute format('drop policy if exists "insert own" on public.%I', t);
    execute format('drop policy if exists "update own" on public.%I', t);
    execute format('drop policy if exists "delete own" on public.%I', t);
  end loop;
end $$;

-- profiles keyed on id, everything else on user_id
create policy "read all"   on public.profiles for select to authenticated using (true);
create policy "insert own" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "update own" on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin()) with check (id = auth.uid() or public.is_admin());
create policy "delete own" on public.profiles for delete to authenticated
  using (id = auth.uid() or public.is_admin());

do $$
declare t text;
begin
  foreach t in array array['subjects','areas','sessions','goals','live_timers'] loop
    execute format('create policy "read all"   on public.%I for select to authenticated using (true)', t);
    execute format('create policy "insert own" on public.%I for insert to authenticated with check (user_id = auth.uid())', t);
    execute format('create policy "update own" on public.%I for update to authenticated using (user_id = auth.uid() or public.is_admin()) with check (user_id = auth.uid() or public.is_admin())', t);
    execute format('create policy "delete own" on public.%I for delete to authenticated using (user_id = auth.uid() or public.is_admin())', t);
  end loop;
end $$;

-- ============================================================
--  Create a profile row automatically on signup
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
--  Let someone delete their own account, and everything in it
-- ------------------------------------------------------------
--  Removing the auth.users row cascades through profiles, subjects,
--  areas, sessions, goals and live_timers. It only ever deletes the
--  caller's own row — auth.uid() is the session's user, and cannot be
--  spoofed from the browser.
-- ============================================================
create or replace function public.delete_own_account()
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  delete from auth.users where id = auth.uid();
end $$;

revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.delete_own_account() to authenticated;

-- ============================================================
--  ADMIN AUDIT LOG
-- ------------------------------------------------------------
--  Every destructive thing the console does writes a row here
--  first. Note what is deliberately missing: there is no update
--  policy and no delete policy, so the log is append-only for
--  everyone including the admin who wrote it. An administrator can
--  delete a member's session, but cannot delete the record of
--  having done so.
--
--  `snapshot` keeps the row as it was immediately before the
--  change, so a deletion is at least reconstructable by hand.
-- ============================================================
create table if not exists public.admin_audit (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid references auth.users on delete set null,
  actor_name   text,
  action       text not null,
  target_user  uuid,
  target_name  text,
  summary      text,
  snapshot     jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists admin_audit_created_idx on public.admin_audit(created_at desc);

alter table public.admin_audit enable row level security;

drop policy if exists "audit read admin"   on public.admin_audit;
drop policy if exists "audit insert admin" on public.admin_audit;

create policy "audit read admin" on public.admin_audit
  for select to authenticated using (public.is_admin());
create policy "audit insert admin" on public.admin_audit
  for insert to authenticated with check (public.is_admin() and actor_id = auth.uid());

-- ============================================================
--  Let an administrator remove somebody else's account outright
-- ------------------------------------------------------------
--  Deleting the auth.users row cascades through profiles, subjects,
--  areas, sessions, goals and live_timers, exactly as it does when
--  someone deletes their own. The guard is inside the function, so
--  it holds no matter what the browser sends: a non-admin calling
--  this gets an exception, not a deletion.
--
--  It refuses to delete the caller. Removing your own login from
--  the admin console would sign you out mid-action and, if you are
--  the only admin, leave the crew with no way to moderate at all.
--  public.delete_own_account() is the deliberate way to do that.
-- ============================================================
create or replace function public.admin_delete_user(target uuid)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin() then
    raise exception 'not an administrator';
  end if;
  if target is null then
    raise exception 'no user given';
  end if;
  if target = auth.uid() then
    raise exception 'use Delete my account to remove your own login';
  end if;
  delete from auth.users where id = target;
end $$;

revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- ============================================================
--  Realtime — so the crew view updates without a refresh
-- ============================================================
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.sessions';    exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.live_timers'; exception when others then null; end;
  begin execute 'alter publication supabase_realtime add table public.profiles';    exception when others then null; end;
end $$;

-- ============================================================
--  Avatar storage
-- ============================================================
insert into storage.buckets (id, name, public)
values ('avatars','avatars',true)
on conflict (id) do nothing;

drop policy if exists "avatars readable"     on storage.objects;
drop policy if exists "avatars upload own"   on storage.objects;
drop policy if exists "avatars update own"   on storage.objects;
drop policy if exists "avatars delete own"   on storage.objects;

create policy "avatars readable" on storage.objects
  for select using (bucket_id = 'avatars');
create policy "avatars upload own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars update own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ============================================================
--  STUDY REMINDERS
--  Web push nudges. No third party service and no email: the
--  browser vendors carry the message, and pg_cron does the timing.
--
--  After running this you still need two things:
--    1. deploy supabase/functions/nudge
--    2. set the VAPID_PRIVATE_KEY secret on that function
--  Generate the keypair with:
--    node -e 'const{generateKeyPairSync}=require("crypto");const{publicKey:a,privateKey:b}=generateKeyPairSync("ec",{namedCurve:"prime256v1"});const p=a.export({format:"jwk"});const u=s=>Buffer.from(s,"base64url");console.log("public:",Buffer.concat([Buffer.from([4]),u(p.x),u(p.y)]).toString("base64url"));console.log("private:",b.export({format:"jwk"}).d)'
--  The public half goes in app.js as VAPID_PUBLIC_KEY and in the
--  function's default; the private half goes in the secret only.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.notification_prefs (
  user_id       uuid primary key references auth.users on delete cascade,
  push_on       boolean not null default false,
  remind_at     time   not null default '19:30',
  timezone      text   not null default 'Australia/Sydney',
  quiet_days    int[]  not null default '{}',      -- 0=Sun .. 6=Sat
  weekly_digest boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_ok_at timestamptz,
  fail_count int not null default 0
);
create index if not exists push_subs_user_idx on public.push_subscriptions(user_id);

create table if not exists public.notification_log (
  id      bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  kind    text not null,
  day     date not null,
  channel text not null default 'push',
  title   text,
  body    text,
  ok      boolean not null default true,
  detail  text,
  sent_at timestamptz not null default now()
);
-- the guard that makes double-sending impossible
create unique index if not exists notif_log_once_idx on public.notification_log(user_id, kind, day);
create index if not exists notif_log_day_idx  on public.notification_log(user_id, day);
create index if not exists notif_log_sent_idx on public.notification_log(sent_at desc);

-- Single-row switch. While live is false only test_user_id is ever sent to,
-- which is how you try the whole thing out without mailing the group.
create table if not exists public.notification_config (
  id           int primary key default 1 check (id = 1),
  live         boolean not null default false,
  test_user_id uuid references auth.users on delete set null,
  cron_secret  text not null default encode(gen_random_bytes(32), 'hex'),
  updated_at   timestamptz not null default now()
);
insert into public.notification_config (id) values (1) on conflict (id) do nothing;

-- ---------- RLS ----------------------------------------------------------
-- Unlike the rest of the app, these are NOT crew-readable. A push endpoint
-- plus its keys is enough to send someone notifications, so it stays shut.
-- notification_config has no policies at all: service role only.
alter table public.notification_prefs  enable row level security;
alter table public.push_subscriptions  enable row level security;
alter table public.notification_log    enable row level security;
alter table public.notification_config enable row level security;

do $$
declare t text;
begin
  foreach t in array array['notification_prefs','push_subscriptions'] loop
    execute format('drop policy if exists "own read"   on public.%I', t);
    execute format('drop policy if exists "own insert" on public.%I', t);
    execute format('drop policy if exists "own update" on public.%I', t);
    execute format('drop policy if exists "own delete" on public.%I', t);
    execute format('create policy "own read"   on public.%I for select to authenticated using (user_id = auth.uid())', t);
    execute format('create policy "own insert" on public.%I for insert to authenticated with check (user_id = auth.uid())', t);
    execute format('create policy "own update" on public.%I for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
    execute format('create policy "own delete" on public.%I for delete to authenticated using (user_id = auth.uid())', t);
  end loop;
end $$;

drop policy if exists "own read" on public.notification_log;
create policy "own read" on public.notification_log for select to authenticated using (user_id = auth.uid());

-- ---------- who needs a nudge right now ---------------------------------
-- Evaluated in each person's own timezone, so 19:30 means 19:30 where they
-- are. Kept in SQL rather than the Edge Function so it can be inspected.
create or replace function public.nudge_candidates()
returns table (
  user_id        uuid,
  display_name   text,
  kind           text,
  local_date     date,
  goal_hours     numeric,
  hours_today    numeric,
  hours_7d       numeric,
  streak_days    int,
  exam_subject   text,
  exam_days      int,
  exam_hours_14d numeric
)
language sql
security definer
set search_path = public
as $fn$
with cfg as (
  select live, test_user_id from public.notification_config where id = 1
),
cur as (
  select np.user_id, np.timezone, np.quiet_days, np.weekly_digest, np.remind_at,
         (now() at time zone np.timezone)::date as local_date,
         (now() at time zone np.timezone)::time as local_time
  from public.notification_prefs np
  cross join cfg
  where np.push_on
    and (cfg.live or np.user_id = cfg.test_user_id)
    and exists (select 1 from public.push_subscriptions ps where ps.user_id = np.user_id)
),
due as (
  select c.* from cur c
  where c.local_time >= c.remind_at
    and c.local_time <  c.remind_at + interval '20 minutes'
    and not (extract(dow from c.local_date)::int = any(c.quiet_days))
    and not exists (
      select 1 from public.notification_log nl
      where nl.user_id = c.user_id and nl.day = c.local_date
    )
),
goal as (
  select d.user_id, p.display_name,
         coalesce(
           (select g.hours from public.goals g
             where g.user_id = d.user_id and g.day = d.local_date),
           case when p.weekday_goals is not null
                then nullif(p.weekday_goals ->> (extract(isodow from d.local_date)::int - 1), '')::numeric
           end,
           p.default_goal
         ) as goal_hours
  from due d join public.profiles p on p.id = d.user_id
),
today as (
  select d.user_id, coalesce(sum(s.minutes), 0) / 60.0 as hours_today
  from due d
  left join public.sessions s on s.user_id = d.user_id and s.day = d.local_date
  group by d.user_id
),
week as (
  select d.user_id, coalesce(sum(s.minutes), 0) / 60.0 as hours_7d
  from due d
  left join public.sessions s on s.user_id = d.user_id
       and s.day > d.local_date - 7 and s.day <= d.local_date
  group by d.user_id
),
streak as (
  select d.user_id,
         coalesce((select min(g.i) from generate_series(1, 60) g(i)
                    where not exists (select 1 from public.sessions s
                                       where s.user_id = d.user_id
                                         and s.day = d.local_date - g.i)) - 1, 60)::int as streak_days
  from due d
),
exam as (
  select distinct on (d.user_id)
         d.user_id, e.subject_id, e.name as exam_subject,
         (e.exam_date - d.local_date)::int as exam_days
  from due d
  join (
    select s.user_id, s.id as subject_id, s.name, s.exam_date
      from public.subjects s where s.exam_date is not null
    union all
    select a.user_id, a.subject_id, sub.name, a.exam_date
      from public.areas a join public.subjects sub on sub.id = a.subject_id
      where a.exam_date is not null
  ) e on e.user_id = d.user_id and e.exam_date >= d.local_date
  order by d.user_id, e.exam_date
),
examhrs as (
  select x.user_id, coalesce(sum(s.minutes), 0) / 60.0 as exam_hours_14d
  from exam x
  join due d on d.user_id = x.user_id
  left join public.sessions s on s.user_id = x.user_id and s.subject_id = x.subject_id
       and s.day > d.local_date - 14 and s.day <= d.local_date
  group by x.user_id
)
select d.user_id, g.display_name,
       case
         when extract(dow from d.local_date)::int = 0 and d.weekly_digest then 'digest'
         when g.goal_hours > 0 and t.hours_today >= g.goal_hours            then 'goal_hit'
         when x.exam_days is not null and x.exam_days <= 14                 then 'exam'
         when st.streak_days >= 3                                          then 'streak'
         else 'goal_miss'
       end as kind,
       d.local_date, g.goal_hours, t.hours_today, w.hours_7d, st.streak_days,
       x.exam_subject, x.exam_days, coalesce(eh.exam_hours_14d, 0)
from due d
join goal   g  on g.user_id  = d.user_id
join today  t  on t.user_id  = d.user_id
join week   w  on w.user_id  = d.user_id
join streak st on st.user_id = d.user_id
left join exam    x  on x.user_id  = d.user_id
left join examhrs eh on eh.user_id = d.user_id
$fn$;

revoke all on function public.nudge_candidates() from public, anon, authenticated;
grant execute on function public.nudge_candidates() to service_role;

-- Count a soft failure against a device, and give up on it after ten.
create or replace function public.bump_push_failure(sub_id uuid)
returns void language sql security definer set search_path = public as $fn$
  update public.push_subscriptions set fail_count = fail_count + 1 where id = sub_id;
  delete from public.push_subscriptions where id = sub_id and fail_count > 10;
$fn$;
revoke all on function public.bump_push_failure(uuid) from public, anon, authenticated;
grant execute on function public.bump_push_failure(uuid) to service_role;

-- ---------- the scheduler ------------------------------------------------
-- Reads the shared secret itself, so the cron.job row holds no credentials.
-- Replace the project ref in the URL if you are not on this project.
create or replace function public.run_nudges()
returns bigint language plpgsql security definer set search_path = public as $fn$
declare secret text; req_id bigint;
begin
  select cron_secret into secret from public.notification_config where id = 1;
  if secret is null then raise exception 'no cron_secret configured'; end if;
  select net.http_post(
    url     := 'https://jebvozocpxhiplvvjobl.supabase.co/functions/v1/nudge',
    body    := jsonb_build_object('mode', 'cron'),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-nudge-key', secret),
    timeout_milliseconds := 30000
  ) into req_id;
  return req_id;
end $fn$;
revoke all on function public.run_nudges() from public, anon, authenticated;

-- Every 15 minutes, all day. The function decides whose local clock has
-- reached their reminder time, so a quarter hour is fine granularity.
select cron.unschedule('study-nudges')
  where exists (select 1 from cron.job where jobname = 'study-nudges');
select cron.schedule('study-nudges', '*/15 * * * *', $$select public.run_nudges()$$);

-- ---------- the calendar feed -------------------------------------------
--  A channel that survives a notification block: the reminder is delivered
--  by the person's own calendar rather than by the browser. Needed because
--  a managed school browser can switch notifications off by policy, and
--  nothing in the page can override that.
--
--  Also deploy supabase/functions/calendar (verify_jwt off: Google Calendar
--  fetches a subscribed feed anonymously and cannot send an auth header,
--  so the token in the query string is the whole access control).
alter table public.notification_prefs
  add column if not exists feed_token uuid not null default gen_random_uuid();

create or replace function public.calendar_feed(token uuid)
returns table (
  user_id      uuid,
  display_name text,
  remind_at    time,
  quiet_days   int[],
  timezone     text
)
language sql security definer set search_path = public as $fn$
  select np.user_id, p.display_name, np.remind_at, np.quiet_days, np.timezone
  from public.notification_prefs np
  join public.profiles p on p.id = np.user_id
  where np.feed_token = token
$fn$;
revoke all on function public.calendar_feed(uuid) from public, anon, authenticated;
grant execute on function public.calendar_feed(uuid) to service_role;

create or replace function public.calendar_exams(target uuid)
returns table (title text, exam_date date)
language sql security definer set search_path = public as $fn$
  select e.title, e.exam_date from (
    select s.name as title, s.exam_date
      from public.subjects s
     where s.user_id = target and s.exam_date is not null
    union
    select sub.name || ' — ' || a.name as title, a.exam_date
      from public.areas a
      join public.subjects sub on sub.id = a.subject_id
     where a.user_id = target and a.exam_date is not null
  ) e
  where e.exam_date >= current_date - 1
  order by e.exam_date, e.title
$fn$;
revoke all on function public.calendar_exams(uuid) from public, anon, authenticated;
grant execute on function public.calendar_exams(uuid) to service_role;

-- ---------- hardening ----------------------------------------------------
-- pg_net grants EXECUTE to PUBLIC on install, handing every signed-in user
-- an HTTP client inside the database. PostgREST does not expose the `net`
-- schema so it is not reachable today, but it is a standing SSRF primitive.
-- run_nudges() is SECURITY DEFINER and owned by postgres, so it is fine.
revoke all on all functions in schema net from public, anon, authenticated;
revoke usage on schema net from public, anon, authenticated;

-- ============================================================
--  NUDGE YOUR MATES
--  A button on someone's profile that prods them to get started.
--  Every rule lives here rather than in the browser: the anon key is
--  public, so anything the client checks, the client can also skip.
-- ============================================================
create table if not exists public.nudges (
  id         uuid primary key default gen_random_uuid(),
  from_user  uuid not null references auth.users on delete cascade,
  to_user    uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  seen_at    timestamptz
);
create index if not exists nudges_inbox_idx on public.nudges(to_user, created_at desc) where seen_at is null;
create index if not exists nudges_pair_idx  on public.nudges(from_user, to_user, created_at desc);

alter table public.nudges enable row level security;

drop policy if exists "nudges read own"    on public.nudges;
drop policy if exists "nudges dismiss own" on public.nudges;

-- You see what you sent and what you were sent. Who is nudging whom is not
-- crew-wide gossip the way sessions deliberately are.
create policy "nudges read own" on public.nudges for select to authenticated
  using (to_user = auth.uid() or from_user = auth.uid());

create policy "nudges dismiss own" on public.nudges for update to authenticated
  using (to_user = auth.uid()) with check (to_user = auth.uid());

-- Deliberately no insert policy: nudge_mate() is the only way a row can
-- appear, which is what makes the rules unskippable.

create or replace function public.nudge_mate(target uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  me        uuid := auth.uid();
  last_sent timestamptz;
  mins_left int;
  new_id    uuid;
  secret    text;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'reason', 'You are not signed in');
  end if;
  if target is null or target = me then
    return jsonb_build_object('ok', false, 'reason', 'You cannot nudge yourself');
  end if;
  if not exists (select 1 from public.profiles where id = target) then
    return jsonb_build_object('ok', false, 'reason', 'That person is not here any more');
  end if;

  -- Mid-session. Five minutes matches LIVE_FRESH_MS in app.js, and a paused
  -- timer counts: they are at their desk either way.
  if exists (select 1 from public.live_timers lt
              where lt.user_id = target and lt.updated_at > now() - interval '5 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'They are studying right now');
  end if;

  if exists (select 1 from public.sessions s
              where s.user_id = target and s.created_at > now() - interval '30 minutes') then
    return jsonb_build_object('ok', false, 'reason', 'They logged a session in the last half hour');
  end if;

  select max(created_at) into last_sent
    from public.nudges where from_user = me and to_user = target;

  if last_sent is not null and last_sent > now() - interval '15 minutes' then
    mins_left := greatest(1, ceil(extract(epoch from
                   (last_sent + interval '15 minutes' - now())) / 60.0));
    return jsonb_build_object('ok', false,
      'reason', 'You have nudged them already. Try again in ' || mins_left ||
                case when mins_left = 1 then ' minute' else ' minutes' end);
  end if;

  insert into public.nudges (from_user, to_user) values (me, target) returning id into new_id;

  -- Best-effort push, only for someone who already asked for notifications.
  -- Failing here must never fail the nudge itself.
  select cron_secret into secret from public.notification_config where id = 1;
  if secret is not null and exists (select 1 from public.notification_prefs np
                                     where np.user_id = target and np.push_on) then
    begin
      perform net.http_post(
        url     := 'https://jebvozocpxhiplvvjobl.supabase.co/functions/v1/nudge',
        body    := jsonb_build_object('mode', 'poke', 'nudge_id', new_id),
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-nudge-key', secret),
        timeout_milliseconds := 20000
      );
    exception when others then null;
    end;
  end if;

  return jsonb_build_object('ok', true, 'id', new_id);
end $fn$;

revoke all on function public.nudge_mate(uuid) from public, anon;
grant execute on function public.nudge_mate(uuid) to authenticated;

-- Realtime, so a nudge lands while they are looking. Each client filters to
-- its own rows, so this never fans out to the whole crew.
do $$
begin
  begin execute 'alter publication supabase_realtime add table public.nudges';
  exception when others then null; end;
end $$;
