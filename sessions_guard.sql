-- =========================================================================
--  SESSIONS GUARD: what the database will not take, whoever is asking
--  -----------------------------------------------------------------------
--  On 6 Oct 2026 one account scripted ~7,000 sessions of 24 hours each in
--  forty minutes, putting 167,000 fake hours in the totals. These rules stop
--  that at the door, whatever the client does:
--    * no session on a day that hasn't happened yet (a day of slack for
--      clocks and time zones);
--    * no day over 20 hours for one person (the busiest real day logged
--      so far was 17.8 h);
--    * no more than 60 sessions logged by one person in an hour (the most
--      anyone real has done is 13).
--  Safe to re-run.
-- =========================================================================
create index if not exists sessions_user_created_idx on public.sessions (user_id, created_at);

create or replace function public.trg_sessions_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'Australia/Sydney')::date;
  day_total int;
begin
  if new.day > today + 1 then
    raise exception 'You can''t log study on a day that hasn''t happened yet' using errcode = 'check_violation';
  end if;
  if new.day < date '2024-01-01' then
    raise exception 'That date is too far back' using errcode = 'check_violation';
  end if;

  if tg_op = 'INSERT' or new.day is distinct from old.day or new.minutes is distinct from old.minutes
     or new.user_id is distinct from old.user_id then
    select coalesce(sum(minutes), 0) into day_total
      from public.sessions
     where user_id = new.user_id and day = new.day
       and (tg_op = 'INSERT' or id <> new.id);
    if day_total + new.minutes > 1200 then
      raise exception 'That would put % over 20 hours, which can''t be right', to_char(new.day, 'Dy DD Mon')
        using errcode = 'check_violation';
    end if;
  end if;

  if tg_op = 'INSERT' and (select count(*) from public.sessions
                            where user_id = new.user_id and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Too many sessions logged in the last hour' using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists sessions_guard on public.sessions;
create trigger sessions_guard before insert or update on public.sessions
  for each row execute function public.trg_sessions_guard();

-- What was taken out, kept where only the database owner can see it.
create table if not exists public.sessions_quarantine as
  select s.*, now() as quarantined_at, ''::text as why from public.sessions s where false;
alter table public.sessions_quarantine enable row level security;
revoke all on public.sessions_quarantine from anon, authenticated;
