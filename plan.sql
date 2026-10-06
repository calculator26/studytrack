-- =========================================================================
--  PLAN — hours you mean to put into a subject on a day still to come
--  -----------------------------------------------------------------------
--  Drawn on the lead-up chart in the Calendar tab, beside what you actually
--  did. Yours alone: nobody else can read your plan. Written only through
--  the functions below, which check the subject is yours and the day is not
--  already over. Safe to re-run.
-- =========================================================================
create table if not exists public.study_plan (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day        date not null,
  subject_id uuid not null references public.subjects(id) on delete cascade,
  hours      numeric(4,2) not null check (hours > 0 and hours <= 12),
  updated_at timestamptz not null default now(),
  primary key (user_id, day, subject_id)
);
create index if not exists study_plan_subject_idx on public.study_plan (subject_id);
alter table public.study_plan enable row level security;

drop policy if exists "plan read own" on public.study_plan;
create policy "plan read own" on public.study_plan
  for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.study_plan from anon, authenticated;
grant select on public.study_plan to authenticated;

-- One day, one subject. Zero hours takes the plan away.
create or replace function public.set_plan(p_day date, p_subject uuid, p_hours numeric)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  today date := (now() at time zone 'Australia/Sydney')::date;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'why', 'You are not signed in');
  end if;
  if not exists (select 1 from public.subjects s where s.id = p_subject and s.user_id = me) then
    return jsonb_build_object('ok', false, 'why', 'That subject is not one of yours');
  end if;
  if p_day < today or p_day > today + 120 then
    return jsonb_build_object('ok', false, 'why', 'Plans are for days still to come');
  end if;
  if coalesce(p_hours, 0) <= 0 then
    delete from public.study_plan where user_id = me and day = p_day and subject_id = p_subject;
    return jsonb_build_object('ok', true, 'hours', 0);
  end if;
  insert into public.study_plan (user_id, day, subject_id, hours, updated_at)
  values (me, p_day, p_subject, least(12, round(p_hours * 4) / 4), now())
  on conflict (user_id, day, subject_id)
    do update set hours = excluded.hours, updated_at = now();
  return jsonb_build_object('ok', true, 'hours', least(12, round(p_hours * 4) / 4));
end $$;

-- Many at once, for "Suggest a plan": [{day, subject_id, hours}, ...].
-- Anything not yours or not ahead of today is skipped rather than failing
-- the lot.
create or replace function public.set_plans(rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  today date := (now() at time zone 'Australia/Sydney')::date;
  r jsonb; n int := 0; d date; s uuid; h numeric;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'why', 'You are not signed in');
  end if;
  if jsonb_typeof(rows) <> 'array' or jsonb_array_length(rows) > 600 then
    return jsonb_build_object('ok', false, 'why', 'Too many at once');
  end if;
  for r in select * from jsonb_array_elements(rows) loop
    begin
      d := (r->>'day')::date; s := (r->>'subject_id')::uuid; h := (r->>'hours')::numeric;
    exception when others then continue;
    end;
    continue when d < today or d > today + 120;
    continue when not exists (select 1 from public.subjects x where x.id = s and x.user_id = me);
    if coalesce(h, 0) <= 0 then
      delete from public.study_plan where user_id = me and day = d and subject_id = s;
    else
      insert into public.study_plan (user_id, day, subject_id, hours, updated_at)
      values (me, d, s, least(12, round(h * 4) / 4), now())
      on conflict (user_id, day, subject_id)
        do update set hours = excluded.hours, updated_at = now();
    end if;
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'written', n);
end $$;

-- Clearing a plan is set_plans with every hour at 0: one way in, one set of
-- checks.

revoke execute on function public.set_plan(date, uuid, numeric) from public, anon;
revoke execute on function public.set_plans(jsonb)             from public, anon;
grant  execute on function public.set_plan(date, uuid, numeric) to authenticated;
grant  execute on function public.set_plans(jsonb)             to authenticated;

notify pgrst, 'reload schema';
