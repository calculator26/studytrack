-- =========================================================================
--  ROLLBACK — take the record back out
--  -----------------------------------------------------------------------
--  Run this if the site is misbehaving after migrate.sql. It removes
--  everything the RECORD section added and touches nothing else: the
--  announcements, the reactions, the busyness graph and every table the app
--  actually reads are left exactly as they are.
--
--  Nothing here can lose anything a person did. study_spans and events hold
--  only the log; the sessions, messages, timers and profiles are separate
--  tables and are not referred to below.
--
--  Safe to run whether or not migrate.sql finished, and safe to run twice.
-- =========================================================================

-- 1. The triggers first, and on their own. These are the only part of the
--    record that sits on a path a person uses, so dropping them is the whole
--    of "stop it interfering" — everything below is just tidying up.
drop trigger if exists live_timers_log      on public.live_timers;
drop trigger if exists sessions_log         on public.sessions;
drop trigger if exists session_reactions_log on public.session_reactions;
drop trigger if exists timer_reactions_log  on public.timer_reactions;
drop trigger if exists profiles_log         on public.profiles;

-- 2. The weekly prune, if pg_cron took it.
do $$ begin perform cron.unschedule('prune-events'); exception when others then null; end $$;

-- 3. The views, then the functions, then the tables.
drop view if exists public.live_by_hour;
drop view if exists public.study_spans_done;

drop function if exists public.trg_live_timers_log();
drop function if exists public.trg_sessions_log();
drop function if exists public.trg_reactions_log();
drop function if exists public.trg_profiles_log();
drop function if exists public.note(text, jsonb);
drop function if exists public.prune_events(int);
drop function if exists public.log_event(text, uuid, uuid, uuid, jsonb);

drop table if exists public.events;
drop table if exists public.study_spans;

-- 4. Tell the API, or it will keep answering from the picture it had.
notify pgrst, 'reload schema';

-- Should read: 0 triggers, 0 tables. The app is back to how it was before
-- the record went in, with everything else from migrate.sql still in place.
select
  (select count(*) from pg_trigger
    where tgname in ('live_timers_log','sessions_log','session_reactions_log',
                     'timer_reactions_log','profiles_log'))                     as triggers_left,
  (select count(*) from information_schema.tables
    where table_schema='public' and table_name in ('events','study_spans'))     as tables_left,
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='live_history')                      as graph_still_there,
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='react')                             as reactions_still_there;
