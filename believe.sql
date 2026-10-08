-- =========================================================================
--  BELIEVE — exam days
--  -----------------------------------------------------------------------
--  On the day of a paper the app shows a band to everyone sitting it, and
--  anyone in the year group can wish the people sitting a paper good luck.
--  A "sitting" is one paper at one time ("2026-10-13|9.50 am|Paper 1 — ..."),
--  so English Standard and Advanced, who sit the same Paper 1, share one.
--
--  Wishes are written and read only through the functions below. Who wished
--  is shown by name, except people in private mode, who are only counted.
--
--  profiles.believe_demo shows the exam-day band early, on your own next
--  paper, so it can be looked at before the HSC starts. Safe to re-run.
-- =========================================================================
alter table public.profiles add column if not exists believe_demo boolean not null default false;

create table if not exists public.exam_wishes (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  exam_date  date not null,
  sitting    text not null check (length(sitting) between 10 and 160),
  created_at timestamptz not null default now(),
  primary key (user_id, exam_date, sitting)
);
create index if not exists exam_wishes_sitting_idx on public.exam_wishes (exam_date, sitting);
alter table public.exam_wishes enable row level security;
revoke all on public.exam_wishes from anon, authenticated;

-- Wish (or un-wish) everyone at one sitting. The day of the paper or the day
-- before; with the preview on, any day in the next month.
create or replace function public.wish_luck(p_date date, p_sitting text, p_on boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  today date := (now() at time zone 'Australia/Sydney')::date;
  demo boolean;
  n int;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'why', 'You are not signed in');
  end if;
  select coalesce(p.believe_demo, false) into demo from public.profiles p where p.id = me;
  if p_date < today or p_date > today + (case when demo then 30 else 1 end) then
    return jsonb_build_object('ok', false, 'why', 'Wishes open the day of the paper');
  end if;
  if p_sitting is null or length(p_sitting) not between 10 and 160 or left(p_sitting, 10) <> p_date::text then
    return jsonb_build_object('ok', false, 'why', 'That is not a paper');
  end if;
  if coalesce(p_on, true) then
    insert into public.exam_wishes (user_id, exam_date, sitting) values (me, p_date, p_sitting)
      on conflict do nothing;
  else
    delete from public.exam_wishes where user_id = me and exam_date = p_date and sitting = p_sitting;
  end if;
  select count(*) into n from public.exam_wishes where exam_date = p_date and sitting = p_sitting;
  return jsonb_build_object('ok', true, 'n', n);
end $$;

-- Every sitting on the given days: how many wished, who (newest first,
-- private mode left out of the names), and whether you did.
create or replace function public.exam_wishes_on(p_dates date[])
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
    from (
      select w.sitting as k,
             jsonb_build_object(
               'n',    count(*),
               'who',  coalesce((select jsonb_agg(x.user_id order by x.created_at desc)
                                   from (select w2.user_id, w2.created_at
                                           from public.exam_wishes w2
                                           join public.profiles p on p.id = w2.user_id and not p.hide_hours
                                          where w2.exam_date = w.exam_date and w2.sitting = w.sitting
                                          order by w2.created_at desc limit 60) x), '[]'::jsonb),
               'mine', bool_or(w.user_id = auth.uid())
             ) as v
        from public.exam_wishes w
       where w.exam_date = any (p_dates[1:4])
       group by w.exam_date, w.sitting
    ) s
$$;

revoke execute on function public.wish_luck(date, text, boolean) from public, anon;
revoke execute on function public.exam_wishes_on(date[])        from public, anon;
grant  execute on function public.wish_luck(date, text, boolean) to authenticated;
grant  execute on function public.exam_wishes_on(date[])        to authenticated;

notify pgrst, 'reload schema';
