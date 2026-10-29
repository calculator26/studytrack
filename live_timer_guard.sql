-- =========================================================================
--  live_timer_guard: an old timer can't overwrite a newer one (29 Oct 2026)
--  -----------------------------------------------------------------------
--  A tab left open on another device still held a timer that had been
--  saved and replaced, and its heartbeat wrote that old timer over the new
--  one every minute, so the board flipped between the two. app.js now only
--  beats onto the same run, but a tab that hasn't reloaded still runs the
--  old code. So the table refuses it too: a write that moves started_at
--  back by more than two minutes is skipped. Pausing and resuming only
--  ever move it forward, and a skipped write is what the app already reads
--  as "leave it". Safe to re-run.
-- =========================================================================
create or replace function public.trg_live_timers_no_rewind()
returns trigger
language plpgsql
as $$
begin
  if new.started_at < old.started_at - interval '2 minutes' then
    return null;
  end if;
  return new;
end $$;

drop trigger if exists live_timers_no_rewind on public.live_timers;
create trigger live_timers_no_rewind before update on public.live_timers
  for each row execute function public.trg_live_timers_no_rewind();
