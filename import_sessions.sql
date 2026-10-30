-- =========================================================================
--  IMPORT SESSIONS: a file import can save sessions older than 7 days (30 Oct 2026)
--  -----------------------------------------------------------------------
--  sessions_guard.sql lets study be logged for the last 7 days only, so the
--  Setup-tab import (runImport in app.js) used to leave older sessions out.
--  Those are real study, from a backup the member already has, so the import
--  now saves through this function instead of a plain insert.
--
--  import_sessions() sets studytrack.importing for its own transaction. The
--  guard in sessions_guard.sql reads that and skips the 7-day rule for these
--  rows only. Every other rule still applies to them, and a day before
--  1 Jan 2024 is refused. The function runs as the signed-in member (security
--  invoker), so the row policies still apply, and it always writes
--  user_id = auth.uid(), whatever the input says. Only signed-in members can
--  call it.
--
--  Run after sessions_guard.sql. Safe to re-run.
-- =========================================================================
create or replace function public.import_sessions(rows jsonb)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  n int;
begin
  perform set_config('studytrack.importing', 'on', true);
  insert into public.sessions (user_id, subject_id, area_id, day, minutes, mode, note, runs)
  select auth.uid(), x.subject_id, x.area_id, x.day, x.minutes, x.mode, x.note, x.runs
    from jsonb_to_recordset(rows) as x(subject_id uuid, area_id uuid, day date, minutes int,
                                       mode text, note text, runs jsonb);
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.import_sessions(jsonb) from public, anon;
grant execute on function public.import_sessions(jsonb) to authenticated;
