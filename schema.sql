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
