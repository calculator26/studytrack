-- =========================================================================
--  exam_clash: no study logged while you are sitting one of your exams
--  (28 Oct 2026)
--  -----------------------------------------------------------------------
--  Run after exams_over.sql. A timer left going for Geography ran straight
--  through its owner's Health and Movement Science paper. A session may not
--  cover any of the time one of YOUR papers is on, unless it is for that
--  paper's own course. "Yours" means a subject whose name is the course
--  name, ignoring case, as in exams_over.sql; app.js also catches subjects
--  typed in by hand, and when a timer is saved it takes the exam out by
--  itself instead of refusing.
--
--  hsc_papers is every paper's start and end, from catalogue.js (the NESA
--  timetable). Change catalogue.js and this together.
--
--  Only bites on writes that add time, move a session or change its
--  subject. The database owner and admins fixing someone else's session are
--  exempt.
--
--  On the day it went in, every session already over one of its owner's
--  papers had the exam cut out of its times, and its minutes brought down
--  to what was left (never raised). A session entirely inside an exam went
--  to sessions_quarantine. What each was before is in session_exam_trims.
--  Safe to re-run.
-- =========================================================================
create table if not exists public.hsc_papers (
  course text not null,
  paper  text not null,
  starts timestamptz not null,
  ends   timestamptz not null,
  primary key (course, starts)
);
alter table public.hsc_papers enable row level security;
revoke all on public.hsc_papers from anon, authenticated;

insert into public.hsc_papers (course, paper, starts, ends) values
  ('agriculture', 'Agriculture', '2026-10-15 13:55 Australia/Sydney', '2026-10-15 17:00 Australia/Sydney'),
  ('ancient history', 'Ancient History', '2026-10-23 09:25 Australia/Sydney', '2026-10-23 12:30 Australia/Sydney'),
  ('biology', 'Biology', '2026-10-21 09:25 Australia/Sydney', '2026-10-21 12:30 Australia/Sydney'),
  ('business studies', 'Business Studies', '2026-10-26 09:25 Australia/Sydney', '2026-10-26 12:30 Australia/Sydney'),
  ('chemistry', 'Chemistry', '2026-10-30 09:25 Australia/Sydney', '2026-10-30 12:30 Australia/Sydney'),
  ('chinese continuers', 'Chinese Continuers', '2026-10-20 14:00 Australia/Sydney', '2026-10-20 17:00 Australia/Sydney'),
  ('chinese extension', 'Chinese Extension', '2026-10-22 14:00 Australia/Sydney', '2026-10-22 16:00 Australia/Sydney'),
  ('chinese in context', 'Chinese in Context', '2026-10-15 14:00 Australia/Sydney', '2026-10-15 16:40 Australia/Sydney'),
  ('design and technology', 'Design and Technology', '2026-10-29 13:55 Australia/Sydney', '2026-10-29 15:30 Australia/Sydney'),
  ('drama', 'Drama', '2026-10-22 13:55 Australia/Sydney', '2026-10-22 15:30 Australia/Sydney'),
  ('earth and environmental science', 'Earth and Environmental Science', '2026-10-15 09:25 Australia/Sydney', '2026-10-15 12:30 Australia/Sydney'),
  ('economics', 'Economics', '2026-10-27 13:55 Australia/Sydney', '2026-10-27 17:00 Australia/Sydney'),
  ('engineering studies', 'Engineering Studies', '2026-10-20 09:25 Australia/Sydney', '2026-10-20 12:30 Australia/Sydney'),
  ('english advanced', 'Paper 1 — Texts and Human Experiences', '2026-10-13 09:50 Australia/Sydney', '2026-10-13 11:30 Australia/Sydney'),
  ('english advanced', 'Paper 2 — Modules', '2026-10-14 09:25 Australia/Sydney', '2026-10-14 11:30 Australia/Sydney'),
  ('english eal/d', 'Paper 1 — Module A and Focus on Writing', '2026-10-13 09:50 Australia/Sydney', '2026-10-13 11:30 Australia/Sydney'),
  ('english eal/d', 'Paper 2 — Module B and Module C', '2026-10-14 09:25 Australia/Sydney', '2026-10-14 10:30 Australia/Sydney'),
  ('english eal/d', 'Listening Paper', '2026-10-14 10:40 Australia/Sydney', '2026-10-14 11:10 Australia/Sydney'),
  ('english extension 1', 'English Extension 1', '2026-10-28 13:50 Australia/Sydney', '2026-10-28 16:00 Australia/Sydney'),
  ('english standard', 'Paper 1 — Texts and Human Experiences', '2026-10-13 09:50 Australia/Sydney', '2026-10-13 11:30 Australia/Sydney'),
  ('english standard', 'Paper 2 — Modules', '2026-10-14 09:25 Australia/Sydney', '2026-10-14 11:30 Australia/Sydney'),
  ('enterprise computing', 'Enterprise Computing', '2026-10-29 09:50 Australia/Sydney', '2026-10-29 12:20 Australia/Sydney'),
  ('french continuers', 'French Continuers', '2026-11-03 14:00 Australia/Sydney', '2026-11-03 17:00 Australia/Sydney'),
  ('geography', 'Geography', '2026-11-02 13:50 Australia/Sydney', '2026-11-02 17:00 Australia/Sydney'),
  ('german continuers', 'German Continuers', '2026-10-13 14:00 Australia/Sydney', '2026-10-13 17:00 Australia/Sydney'),
  ('german extension', 'German Extension', '2026-10-16 14:00 Australia/Sydney', '2026-10-16 16:00 Australia/Sydney'),
  ('health and movement science', 'Health and Movement Science', '2026-10-28 09:20 Australia/Sydney', '2026-10-28 12:30 Australia/Sydney'),
  ('history extension', 'History Extension', '2026-10-21 13:50 Australia/Sydney', '2026-10-21 16:00 Australia/Sydney'),
  ('industrial technology', 'Industrial Technology', '2026-11-04 13:55 Australia/Sydney', '2026-11-04 15:30 Australia/Sydney'),
  ('investigating science', 'Investigating Science', '2026-11-03 13:55 Australia/Sydney', '2026-11-03 17:00 Australia/Sydney'),
  ('japanese beginners', 'Japanese Beginners', '2026-10-13 14:00 Australia/Sydney', '2026-10-13 16:40 Australia/Sydney'),
  ('japanese continuers', 'Japanese Continuers', '2026-10-13 14:00 Australia/Sydney', '2026-10-13 17:00 Australia/Sydney'),
  ('japanese extension', 'Japanese Extension', '2026-10-16 09:30 Australia/Sydney', '2026-10-16 11:30 Australia/Sydney'),
  ('legal studies', 'Legal Studies', '2026-11-02 09:25 Australia/Sydney', '2026-11-02 12:30 Australia/Sydney'),
  ('mathematics advanced', 'Mathematics Advanced', '2026-10-19 09:20 Australia/Sydney', '2026-10-19 12:30 Australia/Sydney'),
  ('mathematics extension 1', 'Mathematics Extension 1', '2026-10-23 13:50 Australia/Sydney', '2026-10-23 16:00 Australia/Sydney'),
  ('mathematics extension 2', 'Mathematics Extension 2', '2026-10-19 13:50 Australia/Sydney', '2026-10-19 17:00 Australia/Sydney'),
  ('mathematics standard 1', 'Mathematics Standard 1', '2026-10-19 09:20 Australia/Sydney', '2026-10-19 11:30 Australia/Sydney'),
  ('mathematics standard 2', 'Mathematics Standard 2', '2026-10-19 09:20 Australia/Sydney', '2026-10-19 12:00 Australia/Sydney'),
  ('modern history', 'Modern History', '2026-10-16 09:25 Australia/Sydney', '2026-10-16 12:30 Australia/Sydney'),
  ('music 1', 'Aural Skills', '2026-10-14 13:55 Australia/Sydney', '2026-10-14 15:00 Australia/Sydney'),
  ('music 2', 'Musicology and Aural Skills', '2026-10-14 15:25 Australia/Sydney', '2026-10-14 17:00 Australia/Sydney'),
  ('physics', 'Physics', '2026-11-05 09:25 Australia/Sydney', '2026-11-05 12:30 Australia/Sydney'),
  ('science extension', 'Science Extension', '2026-10-26 13:50 Australia/Sydney', '2026-10-26 16:00 Australia/Sydney'),
  ('software engineering', 'Software Engineering', '2026-10-27 09:50 Australia/Sydney', '2026-10-27 12:20 Australia/Sydney'),
  ('studies of religion i', 'Studies of Religion I', '2026-10-22 09:25 Australia/Sydney', '2026-10-22 11:00 Australia/Sydney'),
  ('studies of religion ii', 'Studies of Religion II', '2026-10-22 09:25 Australia/Sydney', '2026-10-22 12:30 Australia/Sydney'),
  ('visual arts', 'Art Criticism and Art History', '2026-10-30 13:55 Australia/Sydney', '2026-10-30 15:30 Australia/Sydney')
on conflict (course, starts) do update set paper = excluded.paper, ends = excluded.ends;

/* runs as a multirange, and back */
create or replace function public.runs_range(r jsonb)
returns tstzmultirange
language sql
immutable
as $$
  select coalesce(range_agg(tstzrange((q->>0)::timestamptz, (q->>1)::timestamptz)), '{}'::tstzmultirange)
    from jsonb_array_elements(case when jsonb_typeof(r) = 'array' then r else '[]'::jsonb end) q
   where (q->>1)::timestamptz > (q->>0)::timestamptz
$$;
create or replace function public.range_runs(m tstzmultirange)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_agg(jsonb_build_array(
           to_char(lower(x) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           to_char(upper(x) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by lower(x)), '[]'::jsonb)
    from unnest(m) x
$$;

/* the papers of yours a session's times run into, other than its own course's */
create or replace function public.session_exam_clash(p_user uuid, p_subject uuid, p_runs jsonb)
returns table (course text, paper text, starts timestamptz, ends timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select distinct p.course, p.paper, p.starts, p.ends
    from public.hsc_papers p
    join public.subjects su on su.user_id = p_user and lower(btrim(su.name)) = p.course
   where p.course is distinct from (select lower(btrim(name)) from public.subjects where id = p_subject)
     and public.runs_range(p_runs) && tstzrange(p.starts, p.ends)
     and exists (select 1 from unnest(public.runs_range(p_runs) * tstzmultirange(tstzrange(p.starts, p.ends))) x
                  where upper(x) - lower(x) > interval '1 minute')
$$;
revoke execute on function public.session_exam_clash(uuid, uuid, jsonb) from public, anon, authenticated;

create or replace function public.trg_sessions_exam_clash()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  grows boolean;
  hit   record;
begin
  if auth.uid() is null then return new; end if;
  if jsonb_typeof(new.runs) is distinct from 'array' then return new; end if;
  grows := tg_op = 'INSERT' or new.day is distinct from old.day or new.minutes > old.minutes
           or new.runs is distinct from old.runs or new.subject_id is distinct from old.subject_id;
  if not grows then return new; end if;
  if tg_op = 'UPDATE' and new.user_id <> auth.uid() and coalesce(public.is_admin(), false) then return new; end if;
  select * into hit from public.session_exam_clash(new.user_id, new.subject_id, new.runs) limit 1;
  if found then
    raise exception 'That runs into your % exam (% to %). Take the exam out of it, or log it under %',
      hit.paper,
      to_char(hit.starts at time zone 'Australia/Sydney', 'FMHH12:MIam Dy DD Mon'),
      to_char(hit.ends at time zone 'Australia/Sydney', 'FMHH12:MIam'),
      initcap(hit.course)
      using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke execute on function public.trg_sessions_exam_clash() from public, anon, authenticated;

drop trigger if exists sessions_exam_clash on public.sessions;
create trigger sessions_exam_clash before insert or update on public.sessions
  for each row execute function public.trg_sessions_exam_clash();

-- ---------- the one-off cut ----------
create table if not exists public.session_exam_trims (
  session_id     uuid primary key,
  user_id        uuid not null,
  day            date not null,
  minutes_before int not null,
  minutes_after  int not null,
  runs_before    jsonb,
  papers         text,
  trimmed_at     timestamptz not null default now()
);
alter table public.session_exam_trims enable row level security;
revoke all on public.session_exam_trims from anon, authenticated;

with c as (
  select s.id, s.user_id, s.day, s.minutes, s.runs,
         string_agg(x.paper, ', ') papers,
         public.runs_range(s.runs) - range_agg(tstzrange(x.starts, x.ends)) left_over
    from public.sessions s
    cross join lateral public.session_exam_clash(s.user_id, s.subject_id, s.runs) x
   where jsonb_typeof(s.runs) = 'array'
   group by s.id
), n as (
  select c.*, public.range_runs(left_over) new_runs,
         least(c.minutes, round(public.session_runs_minutes(public.range_runs(left_over)))::int) new_min
    from c
), logged as (
  insert into public.session_exam_trims (session_id, user_id, day, minutes_before, minutes_after, runs_before, papers)
  select id, user_id, day, minutes, new_min, runs, papers from n
  on conflict (session_id) do nothing
  returning session_id
), gone as (
  insert into public.sessions_quarantine
  select s.*, now(), 'entirely inside an exam (exam_clash.sql)'
    from public.sessions s join n using (id) join logged l on l.session_id = n.id
   where n.new_min < 1
  returning id
), del as (
  delete from public.sessions s using gone g where s.id = g.id returning s.id
)
update public.sessions s set runs = n.new_runs, minutes = n.new_min
  from n join logged l on l.session_id = n.id
 where s.id = n.id and n.new_min >= 1;
