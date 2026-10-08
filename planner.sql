-- =========================================================================
--  PLANNER — the day's to-do list, on the Calendar tab
--  -----------------------------------------------------------------------
--  Each to-do belongs to a day, optionally to one of your subjects (and an
--  area within it), and optionally has a time block (9.00 – 10.30) or just a
--  length (45 minutes, any time that day). Up to three a day can be
--  starred as that day's Top 3. Anything not ticked off by the end of its
--  day is offered, not moved: "Bring to today" in the planner runs
--  todo_carry.
--
--  Yours alone, like study_plan: nobody else can read your list, and it is
--  written only through the functions below. Safe to re-run.
-- =========================================================================
create table if not exists public.study_todos (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day          date not null,
  title        text not null check (char_length(title) between 1 and 200),
  subject_id   uuid references public.subjects(id) on delete set null,
  area_id      uuid references public.areas(id) on delete set null,
  start_time   time,
  end_time     time,
  minutes      int check (minutes between 5 and 720),
  priority     boolean not null default false,
  done         boolean not null default false,
  done_at      timestamptz,
  carried_from date,
  position     int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (end_time is null or (start_time is not null and end_time > start_time))
);
-- added after the first release: the area within the subject, and a length
alter table public.study_todos add column if not exists area_id uuid references public.areas(id) on delete set null;
alter table public.study_todos add column if not exists minutes int check (minutes between 5 and 720);

create index if not exists study_todos_user_day_idx on public.study_todos (user_id, day);
create index if not exists study_todos_subject_idx  on public.study_todos (subject_id);
alter table public.study_todos enable row level security;

drop policy if exists "todos read own" on public.study_todos;
create policy "todos read own" on public.study_todos
  for select to authenticated using (user_id = (select auth.uid()));
revoke insert, update, delete on public.study_todos from anon, authenticated;
grant select on public.study_todos to authenticated;

-- Timing is either a block (start, and end or a length) or just a length,
-- which puts it under Anytime. With a start and an end, the length is
-- worked out from them; with a start and a length, the end is.
--
-- Add or change one to-do. p_id null adds; otherwise the to-do must be
-- yours. Only the keys present in p are changed, so ticking one off sends
-- just {"done": true}.
create or replace function public.todo_save(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  today date := (now() at time zone 'Australia/Sydney')::date;
  cur public.study_todos;
  v_day date; v_title text; v_sub uuid; v_area uuid; v_st time; v_et time; v_min int; v_pri boolean; v_done boolean;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'why', 'You are not signed in');
  end if;
  if p_id is not null then
    select * into cur from public.study_todos where id = p_id and user_id = me;
    if not found then
      return jsonb_build_object('ok', false, 'why', 'That to-do is not there any more');
    end if;
  end if;

  begin
    v_day   := case when p ? 'day'        then (p->>'day')::date        else cur.day end;
    v_title := case when p ? 'title'      then btrim(p->>'title')       else cur.title end;
    v_sub   := case when p ? 'subject_id' then nullif(p->>'subject_id', '')::uuid else cur.subject_id end;
    v_area  := case when p ? 'area_id'    then nullif(p->>'area_id', '')::uuid    else cur.area_id end;
    v_min   := case when p ? 'minutes'    then nullif(p->>'minutes', '')::int     else cur.minutes end;
    v_st    := case when p ? 'start_time' then nullif(p->>'start_time', '')::time else cur.start_time end;
    v_et    := case when p ? 'end_time'   then nullif(p->>'end_time', '')::time   else cur.end_time end;
    v_pri   := case when p ? 'priority'   then (p->>'priority')::boolean else coalesce(cur.priority, false) end;
    v_done  := case when p ? 'done'       then (p->>'done')::boolean     else coalesce(cur.done, false) end;
  exception when others then
    return jsonb_build_object('ok', false, 'why', 'Something in that to-do did not make sense');
  end;

  if v_title is null or char_length(v_title) = 0 then
    return jsonb_build_object('ok', false, 'why', 'Give it a name');
  end if;
  v_title := left(v_title, 200);
  if v_day is null or v_day > today + 120 then
    return jsonb_build_object('ok', false, 'why', 'Pick a day in the next four months');
  end if;
  -- a new to-do, or one moved, has to land on a day still to come
  if (p_id is null or v_day <> cur.day) and v_day < today then
    return jsonb_build_object('ok', false, 'why', 'That day is already over');
  end if;
  if v_sub is not null and not exists (select 1 from public.subjects s where s.id = v_sub and s.user_id = me) then
    return jsonb_build_object('ok', false, 'why', 'That subject is not one of yours');
  end if;
  -- an area has to be one of yours, inside the subject chosen
  if v_area is not null and (v_sub is null or not exists (
       select 1 from public.areas a where a.id = v_area and a.user_id = me and a.subject_id = v_sub)) then
    v_area := null;
  end if;
  if v_st is null then v_et := null; end if;
  if v_et is not null and v_et <= v_st then
    return jsonb_build_object('ok', false, 'why', 'It has to finish after it starts');
  end if;
  if v_st is not null and v_et is not null then
    v_min := (extract(epoch from (v_et - v_st)) / 60)::int;
  elsif v_st is not null and v_min is not null then
    if v_st + make_interval(mins => v_min) <= v_st then
      return jsonb_build_object('ok', false, 'why', 'That runs past midnight');
    end if;
    v_et := v_st + make_interval(mins => v_min);
  end if;
  if v_min is not null and (v_min < 5 or v_min > 720) then
    return jsonb_build_object('ok', false, 'why', 'A session is between 5 minutes and 12 hours');
  end if;
  if v_pri and (select count(*) from public.study_todos t
                 where t.user_id = me and t.day = v_day and t.priority and t.id is distinct from p_id) >= 3 then
    return jsonb_build_object('ok', false, 'why', 'You already have a Top 3 for that day. Unstar one first.');
  end if;

  if p_id is null then
    insert into public.study_todos (user_id, day, title, subject_id, area_id, start_time, end_time, minutes, priority, done, done_at, position)
    values (me, v_day, v_title, v_sub, v_area, v_st, v_et, v_min, v_pri, v_done, case when v_done then now() end,
            coalesce((select max(position) + 1 from public.study_todos where user_id = me and day = v_day), 0))
    returning * into cur;
  else
    update public.study_todos set
      day = v_day, title = v_title, subject_id = v_sub, area_id = v_area, start_time = v_st, end_time = v_et, minutes = v_min,
      priority = v_pri, done = v_done,
      done_at = case when v_done and not cur.done then now() when not v_done then null else done_at end,
      updated_at = now()
    where id = p_id
    returning * into cur;
  end if;
  return jsonb_build_object('ok', true, 'todo', to_jsonb(cur));
end $$;

create or replace function public.todo_delete(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'why', 'You are not signed in');
  end if;
  delete from public.study_todos where id = p_id and user_id = auth.uid();
  return jsonb_build_object('ok', true);
end $$;

-- Unfinished to-dos from days already over move to today. They lose their
-- time block (yesterday's 9 am is not today's) but keep their length, so
-- they land in Anytime; they lose their star (choose today's Top 3 fresh),
-- and remember the day they were first meant for.
create or replace function public.todo_carry()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  today date := (now() at time zone 'Australia/Sydney')::date;
  n int;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'why', 'You are not signed in');
  end if;
  update public.study_todos set
    carried_from = coalesce(carried_from, day), day = today,
    start_time = null, end_time = null, priority = false, updated_at = now()
  where user_id = me and day < today and not done;
  get diagnostics n = row_count;
  return jsonb_build_object('ok', true, 'carried', n);
end $$;

revoke execute on function public.todo_save(uuid, jsonb) from public, anon;
revoke execute on function public.todo_delete(uuid)      from public, anon;
revoke execute on function public.todo_carry()           from public, anon;
grant  execute on function public.todo_save(uuid, jsonb) to authenticated;
grant  execute on function public.todo_delete(uuid)      to authenticated;
grant  execute on function public.todo_carry()           to authenticated;

notify pgrst, 'reload schema';
