-- =========================================================================
--  MIGRATE — everything added since the last time you ran schema.sql
--  -----------------------------------------------------------------------
--  Paste the whole file into the Supabase SQL editor and run it. That is the
--  only step. Safe to run as many times as you like, and the last statement
--  prints whether it worked.
--
--  Why this file and not schema.sql: the editor runs a script as one
--  transaction and aborts on the first error, showing only that error. New
--  work lands at the bottom of a very long file, so it is the first thing
--  lost to an unrelated failure above it and the last place anyone looks.
--
--  Nothing here writes to a table the app reads from, and every trigger
--  swallows its own errors, so a failure in the record cannot fail a
--  person's timer, session, reaction or message. There is a test for that.
-- =========================================================================

-- ============================================================
--  ADMIN ANNOUNCEMENTS
--  ------------------------------------------------------------
--  A message from the console that does not look like a message.
--  Two separate rules, and it matters which is which:
--
--    1. Only an administrator can make one. That is enforced
--       here, by is_admin() inside send_announcement(), and it
--       holds against anything the browser sends. A member who
--       calls this function gets turned away exactly as they
--       would if they called admin_delete_user().
--
--    2. It has to come from the console rather than the ordinary
--       chat box. That one is a convention, not a wall, and the
--       honest way to say it is that send_message() simply has
--       no way to set the flag — it always writes false. So an
--       admin typing in the normal composer posts a normal
--       message, which is the point: the badge cannot be worn by
--       accident, only on purpose. An admin who wants to call
--       this RPC from the browser console still can, and that is
--       fine, because they are already the person allowed to.
--
--  The flag lives on the row rather than in a separate table so
--  that the room's existing paging, realtime and delete policy
--  all keep working untouched.
-- ============================================================
alter table public.messages
  add column if not exists announcement boolean not null default false;

-- Announcements may run longer than a chat line — they carry notices, not
-- banter. The table now allows a thousand characters; send_message() still
-- holds ordinary members to five hundred, so nothing about the room changes.
alter table public.messages drop constraint if exists messages_body_check;
alter table public.messages add constraint messages_body_check
  check (length(btrim(body)) <= 1000
         and (length(btrim(body)) > 0 or image_path is not null));

-- An announcement is always worth finding quickly, and there are few of them.
create index if not exists messages_ann_idx
  on public.messages (created_at desc) where announcement;

-- The badge an announcement wears. Null means the plain "Admin"; anything else
-- is what the console was told to call this one, so a timetable notice and a
-- social justice notice do not have to arrive under the same word. Constrained
-- to announcements so an ordinary message cannot carry a label, and kept short
-- because it renders as a letterspaced badge rather than a sentence.
alter table public.messages add column if not exists ann_label text;
alter table public.messages drop constraint if exists messages_ann_label_check;
alter table public.messages add constraint messages_ann_label_check
  check (ann_label is null
         or (announcement and length(btrim(ann_label)) between 1 and 24));

-- Dropped rather than replaced: adding arguments to a function creates an
-- overload beside the old one rather than superseding it, and an old one-argument
-- send_announcement left sitting there is a second way in that nobody maintains.
drop function if exists public.send_announcement(text);

create or replace function public.send_announcement(
  body text,
  label text default null,
  mentions uuid[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  me     uuid := auth.uid();
  txt    text := btrim(body);
  lbl    text := nullif(btrim(coalesce(label, '')), '');
  who    uuid[];
  recent int;
  new_id uuid;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'why', 'You are not signed in');
  end if;

  -- The whole of the security. Checked in the function rather than trusted
  -- from the caller, so it holds no matter which page the call came from.
  if not public.is_admin() then
    return jsonb_build_object('ok', false, 'why', 'Only an administrator can announce');
  end if;

  if txt = '' then
    return jsonb_build_object('ok', false, 'why', 'Nothing to announce');
  end if;
  if length(txt) > 1000 then
    return jsonb_build_object('ok', false, 'why', 'That is longer than 1000 characters');
  end if;
  if lbl is not null and length(lbl) > 24 then
    return jsonb_build_object('ok', false, 'why', 'A label is at most 24 characters');
  end if;

  -- Not a flood limit — an administrator is trusted. This is a guard against
  -- a stuck button or a loop putting the same notice up four hundred times.
  select count(*) into recent
    from public.messages
   where user_id = me and announcement and created_at > now() - interval '60 seconds';
  if recent >= 3 then
    return jsonb_build_object('ok', false, 'why', 'Three announcements in a minute is the limit');
  end if;

  -- Only real members, and never the same person twice. Unlike send_message()
  -- this does NOT drop the sender: an announcement carries no name, so naming
  -- yourself in one ("see @Lewis at lunch") is the only way to put a contact on
  -- it, and dropping it silently would be the wrong answer to a fair request.
  select coalesce(array_agg(distinct p.id), '{}')
    into who
    from public.profiles p
   where p.id = any(mentions);

  insert into public.messages (user_id, body, image_path, mentions, announcement, ann_label)
  values (me, txt, null, who, true, lbl)
  returning id into new_id;

  return jsonb_build_object('ok', true, 'id', new_id);
end $fn$;

revoke execute on function public.send_announcement(text, text, uuid[]) from public, anon;
grant  execute on function public.send_announcement(text, text, uuid[]) to authenticated;

-- ============================================================
--  REACTIONS
--  ------------------------------------------------------------
--  Two ways to answer somebody's session: kudos, or calling it
--  suspicious. The second one is the point of the feature — six
--  hours on a Tuesday invites a raised eyebrow, and the board is
--  more honest when the eyebrow is a button rather than a rumour.
--
--  It is deliberately NOT anonymous. Who reacted comes back with
--  the counts and the app shows it. An anonymous pile-on aimed at
--  a named person is a different and worse thing than a visible
--  one, and everything else in this app is public and named
--  already. One reaction per person per session, so the primary
--  key does the rest: nobody can stack five of them on a row.
--
--  Writes go through react() rather than the table, the same way
--  messages do, because two rules have to hold no matter what the
--  browser sends: the kind has to be one of the two, and you
--  cannot react to yourself.
-- ============================================================
create table if not exists public.session_reactions (
  session_id uuid not null references public.sessions(id) on delete cascade,
  user_id    uuid not null references auth.users(id)      on delete cascade,
  kind       text not null check (kind in ('kudos', 'sus')),
  created_at timestamptz not null default now(),
  primary key (session_id, user_id)
);
create index if not exists session_reactions_session_idx on public.session_reactions(session_id);

alter table public.session_reactions enable row level security;
drop policy if exists "reactions read all"   on public.session_reactions;
drop policy if exists "reactions delete own" on public.session_reactions;

create policy "reactions read all" on public.session_reactions
  for select to authenticated using (true);

-- Yours to take back, and an administrator can remove anyone's, the same as
-- every other thing a person can put on the screen here.
create policy "reactions delete own" on public.session_reactions
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- No insert or update policy on purpose: react() is the only way in.
revoke insert, update on public.session_reactions from anon, authenticated;

-- One button press. Pressing the one you already chose takes it back, pressing
-- the other one switches; there is no third state to get stuck in.
create or replace function public.react(session_id uuid, kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  /* The arguments are copied into locals straight away and never touched
     again. They are named session_id and kind because those are the keys the
     app sends, but a parameter called session_id shadows the column of the
     same name, and "on conflict (session_id, user_id)" then cannot tell which
     one is meant — it is not a warning, it is an error at call time, and only
     on the insert path. Copying once is the whole fix. */
  sid   uuid := react.session_id;
  me    uuid := auth.uid();
  k     text := nullif(btrim(coalesce(react.kind, '')), '');
  owner uuid;
  had   text;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'why', 'You are not signed in');
  end if;
  if k is not null and k not in ('kudos', 'sus') then
    return jsonb_build_object('ok', false, 'why', 'Not a reaction');
  end if;

  select s.user_id into owner from public.sessions s where s.id = sid;
  if owner is null then
    return jsonb_build_object('ok', false, 'why', 'That session is gone');
  end if;
  if owner = me then
    return jsonb_build_object('ok', false, 'why', 'You cannot react to your own session');
  end if;

  select r.kind into had
    from public.session_reactions r
   where r.session_id = sid and r.user_id = me;

  if k is null or k = had then
    delete from public.session_reactions r
     where r.session_id = sid and r.user_id = me;
  else
    insert into public.session_reactions (session_id, user_id, kind)
    values (sid, me, k)
    /* By constraint name, not by column list. A parameter called session_id
       shadows the column, and an "on conflict (session_id, ...)" target cannot
       be qualified the way an ordinary reference can — naming the constraint
       sidesteps the whole question. */
    on conflict on constraint session_reactions_pkey
      do update set kind = excluded.kind, created_at = now();
  end if;

  return jsonb_build_object('ok', true, 'mine',
    case when k is null or k = had then null else k end);
end $fn$;

revoke execute on function public.react(uuid, text) from public, anon;
grant  execute on function public.react(uuid, text) to authenticated;

-- Asked for by the page for exactly the rows it is about to draw — your own
-- day and the forty in the feed — rather than the table being held client-side
-- like the old full-database reads this app spent a commit getting rid of.
-- The ids come back with it so the app can say who, resolving the names from
-- the profiles it already holds.
create or replace function public.reactions_for(ids uuid[])
returns table (session_id uuid, kudos_by uuid[], sus_by uuid[])
language sql
stable
security definer
set search_path = public
as $$
  select r.session_id,
         coalesce(array_agg(r.user_id) filter (where r.kind = 'kudos'), '{}'),
         coalesce(array_agg(r.user_id) filter (where r.kind = 'sus'),   '{}')
    from public.session_reactions r
   where r.session_id = any(ids)
   group by r.session_id
$$;

revoke execute on function public.reactions_for(uuid[]) from public, anon;
grant  execute on function public.reactions_for(uuid[]) to authenticated;

-- ============================================================
--  REACTIONS ON A RUNNING TIMER
--  ------------------------------------------------------------
--  The same two answers, aimed at somebody who is working right
--  now rather than at a block they already logged. Cheering
--  somebody on at 9pm is the half of this the finished-session
--  reactions cannot do, and a four-hour clock still ticking is
--  the most natural thing in the app to raise an eyebrow at.
--
--  Two ways a reaction stops being about the thing it was
--  aimed at, and both are handled without a sweeper job:
--
--    * They stop the timer. The row in live_timers goes, and
--      the foreign key takes these with it.
--    * They stop and start a new one. The row stays but its
--      started_at moves, so every reaction stores the
--      started_at it was aimed at, reads ignore any that do
--      not match, and the next reaction clears them out.
-- ============================================================
create table if not exists public.timer_reactions (
  owner_id       uuid not null references public.live_timers(user_id) on delete cascade,
  user_id        uuid not null references auth.users(id)              on delete cascade,
  kind           text not null check (kind in ('kudos', 'sus')),
  for_started_at timestamptz not null,
  created_at     timestamptz not null default now(),
  primary key (owner_id, user_id)
);

alter table public.timer_reactions enable row level security;
drop policy if exists "timer reactions read all"   on public.timer_reactions;
drop policy if exists "timer reactions delete own" on public.timer_reactions;

create policy "timer reactions read all" on public.timer_reactions
  for select to authenticated using (true);
create policy "timer reactions delete own" on public.timer_reactions
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

revoke insert, update on public.timer_reactions from anon, authenticated;

create or replace function public.react_timer(owner_id uuid, kind text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  /* Copied out of the arguments for the same reason react() does it: a
     parameter sharing a column's name makes the insert ambiguous. */
  own   uuid := react_timer.owner_id;
  me    uuid := auth.uid();
  k     text := nullif(btrim(coalesce(react_timer.kind, '')), '');
  began timestamptz;
  had   text;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'why', 'You are not signed in');
  end if;
  if k is not null and k not in ('kudos', 'sus') then
    return jsonb_build_object('ok', false, 'why', 'Not a reaction');
  end if;
  if own = me then
    return jsonb_build_object('ok', false, 'why', 'You cannot react to your own timer');
  end if;

  select t.started_at into began from public.live_timers t where t.user_id = own;
  if began is null then
    return jsonb_build_object('ok', false, 'why', 'They are not running a timer');
  end if;

  /* Anything aimed at a previous run of this person's timer is no longer about
     what is on the screen. Cleared here rather than by a job. */
  delete from public.timer_reactions r
   where r.owner_id = own and r.for_started_at <> began;

  select r.kind into had
    from public.timer_reactions r
   where r.owner_id = own and r.user_id = me and r.for_started_at = began;

  if k is null or k = had then
    delete from public.timer_reactions r where r.owner_id = own and r.user_id = me;
  else
    insert into public.timer_reactions (owner_id, user_id, kind, for_started_at)
    values (own, me, k, began)
    on conflict on constraint timer_reactions_pkey
      do update set kind = excluded.kind, for_started_at = excluded.for_started_at,
                    created_at = now();
  end if;

  return jsonb_build_object('ok', true);
end $fn$;

revoke execute on function public.react_timer(uuid, text) from public, anon;
grant  execute on function public.react_timer(uuid, text) to authenticated;

-- ============================================================
--  HOW MANY PEOPLE WERE ON THE CLOCK AT ONCE
--  ------------------------------------------------------------
--  live_timers is a photograph of right now, so a graph of how
--  busy the room gets needs somebody to keep the photographs.
--
--  Not pg_cron. This is one row an hour and it only matters when
--  somebody is actually studying — and somebody studying has
--  their own tab open by definition, because that tab is what
--  sends the heartbeat the live strip reads. So the clients do
--  it: whoever notices the hour has turned over calls note_live()
--  once, and the highest count any of them saw is what the hour
--  keeps. A project with nobody online records nothing, which is
--  the correct answer rather than a gap.
--
--  The count is taken here rather than sent, so it cannot be
--  invented by a browser: a bored member cannot post a record of
--  four hundred.
-- ============================================================
create table if not exists public.live_samples (
  bucket timestamptz primary key,      -- the hour, truncated
  peak   int not null                  -- most people on the clock at once in it
);

alter table public.live_samples enable row level security;
drop policy if exists "samples read all" on public.live_samples;
create policy "samples read all" on public.live_samples
  for select to authenticated using (true);
revoke insert, update, delete on public.live_samples from anon, authenticated;

create or replace function public.note_live()
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare
  now_bucket timestamptz := date_trunc('hour', now());
  live       int;
begin
  if auth.uid() is null then return 0; end if;

  /* The same freshness rule the strip draws by: a running timer has to have
     checked in within five minutes, or its owner has closed the laptop and is
     not studying, whatever the row says. */
  select count(*) into live
    from public.live_timers t
   where t.running and t.updated_at > now() - interval '5 minutes';

  insert into public.live_samples (bucket, peak)
  values (now_bucket, live)
  on conflict on constraint live_samples_pkey
    do update set peak = greatest(public.live_samples.peak, excluded.peak);

  return live;
end $fn$;

revoke execute on function public.note_live() from public, anon;
grant  execute on function public.note_live() to authenticated;

-- The line, plus the record to draw it against. Hours nobody studied come back
-- as zero rather than as gaps, so the line does not lie by joining across them.
create or replace function public.live_history(hours int default 48)
returns table (bucket timestamptz, peak int, best int)
language sql
stable
security definer
set search_path = public
as $$
  with span as (
    select generate_series(
      date_trunc('hour', now()) - (least(greatest(coalesce(hours, 48), 1), 720) - 1) * interval '1 hour',
      date_trunc('hour', now()),
      interval '1 hour') as b
  )
  select span.b,
         coalesce(s.peak, 0)::int,
         (select coalesce(max(peak), 0)::int from public.live_samples)
    from span left join public.live_samples s on s.bucket = span.b
   order by span.b
$$;

revoke execute on function public.live_history(int) from public, anon;
grant  execute on function public.live_history(int) to authenticated;

-- ============================================================
--  THE RECORD
--  ------------------------------------------------------------
--  Keep what the app currently throws away, so a feature thought
--  of next year is not blocked by a year of missing history.
--
--  WHAT IS DELIBERATELY *NOT* RECORDED HERE, AND WHY
--  Sessions, messages, profiles, goals and subjects are already
--  permanent rows. Copying them into a log would double the
--  storage bill to learn nothing, so this records only what
--  vanishes:
--
--    * a live study span — live_timers is one row per person that
--      gets overwritten and then deleted, so every span the app
--      has ever shown is already gone
--    * the old values behind an edit, and anything deleted
--    * reactions taken back
--    * who signed in, and when
--
--  THE VOLUME TRAP, WHICH IS THE WHOLE REASON TO READ THIS
--  A running client writes to live_timers every sixty seconds to
--  say "still here". A naive row-level trigger would log every one
--  of those: four hundred people times sixty an hour is half a
--  million rows a day and a bill to match. So the trigger below
--  ignores any update that did not change something a person did,
--  and there is a test for exactly that.
--
--  Rough size at four hundred people: spans about 1,200 rows a
--  day, events about 6,000 — call it two megabytes a day. Events
--  older than 400 days are pruned, which keeps a whole HSC year;
--  spans are small enough to keep forever.
-- ============================================================

-- ------------------------------------------------------------
--  Every live study span, start to finish.
-- ------------------------------------------------------------
create table if not exists public.study_spans (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  started_at  timestamptz not null,
  ended_at    timestamptz,                  -- null while it is still running
  ended_why   text,                         -- stopped | restarted | expired
  label       text,
  subject_id  uuid,
  area_id     uuid,
  acc_ms      bigint,                       -- what the clock read at the end
  day         date not null default (now() at time zone 'Australia/Sydney')::date
);
create index if not exists study_spans_user_idx on public.study_spans(user_id, started_at desc);
create index if not exists study_spans_open_idx on public.study_spans(user_id) where ended_at is null;
create index if not exists study_spans_day_idx  on public.study_spans(day);

-- ------------------------------------------------------------
--  Everything else, one shape, so a new kind of event needs no
--  migration — only a new string.
-- ------------------------------------------------------------
create table if not exists public.events (
  id      bigserial primary key,
  at      timestamptz not null default now(),
  actor   uuid,                             -- who did it
  kind    text not null,                    -- 'reaction.remove', 'session.delete', ...
  subject uuid,                             -- who it was done to, when that differs
  ref     uuid,                             -- the row it concerns
  data    jsonb not null default '{}'::jsonb
);
create index if not exists events_at_idx    on public.events(at desc);
create index if not exists events_kind_idx  on public.events(kind, at desc);
create index if not exists events_actor_idx on public.events(actor, at desc);

alter table public.study_spans enable row level security;
alter table public.events      enable row level security;
drop policy if exists "spans read"  on public.study_spans;
drop policy if exists "events read" on public.events;

-- Your own, or everything if you run the console. Nobody writes to either
-- from a browser at all: the triggers below are the only authors.
create policy "spans read" on public.study_spans
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy "events read" on public.events
  for select to authenticated using (actor = auth.uid() or public.is_admin());

revoke insert, update, delete on public.study_spans from anon, authenticated;
revoke insert, update, delete on public.events      from anon, authenticated;

-- ------------------------------------------------------------
--  Writing to the log must never be able to fail a real write.
--  Everything goes through here, and here swallows its own
--  errors: a missing column or a bad cast costs a log line, not
--  somebody's session.
-- ------------------------------------------------------------
create or replace function public.log_event(
  p_kind text, p_actor uuid, p_subject uuid, p_ref uuid, p_data jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.events (actor, kind, subject, ref, data)
  values (p_actor, p_kind, p_subject, p_ref, coalesce(p_data, '{}'::jsonb));
exception when others then
  return;                                   -- never break the caller
end $fn$;

revoke all on function public.log_event(text, uuid, uuid, uuid, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------
--  LIVE STUDY SPANS
--
--  The heartbeat is the thing to get right. A running client
--  touches updated_at every sixty seconds; none of those are
--  events. Only a change to started_at, running or the label is
--  something a person did, and only those are written.
-- ------------------------------------------------------------
create or replace function public.trg_live_timers_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'INSERT' then
    insert into public.study_spans (user_id, started_at, label, subject_id, area_id)
    values (new.user_id, new.started_at, new.label, new.subject_id, new.area_id);
    perform public.log_event('timer.start', new.user_id, null, null,
      jsonb_build_object('label', new.label, 'started_at', new.started_at));

  elsif tg_op = 'UPDATE' then
    -- The heartbeat, and nothing else, leaves every one of these alone.
    if new.started_at is not distinct from old.started_at
       and new.running is not distinct from old.running
       and new.label   is not distinct from old.label then
      return null;
    end if;

    if new.started_at is distinct from old.started_at then
      -- a fresh run: close whatever was open and begin again
      update public.study_spans s
         set ended_at = now(), ended_why = 'restarted', acc_ms = old.acc_ms
       where s.user_id = old.user_id and s.ended_at is null;
      insert into public.study_spans (user_id, started_at, label, subject_id, area_id)
      values (new.user_id, new.started_at, new.label, new.subject_id, new.area_id);
      perform public.log_event('timer.restart', new.user_id, null, null,
        jsonb_build_object('label', new.label));

    elsif new.running is distinct from old.running then
      perform public.log_event(case when new.running then 'timer.resume' else 'timer.pause' end,
        new.user_id, null, null, jsonb_build_object('acc_ms', new.acc_ms, 'label', new.label));

    else
      -- they changed what they are working on mid-session
      update public.study_spans s
         set label = new.label, subject_id = new.subject_id, area_id = new.area_id
       where s.user_id = new.user_id and s.ended_at is null;
      perform public.log_event('timer.relabel', new.user_id, null, null,
        jsonb_build_object('from', old.label, 'to', new.label));
    end if;

  elsif tg_op = 'DELETE' then
    update public.study_spans s
       set ended_at = now(), ended_why = 'stopped', acc_ms = old.acc_ms
     where s.user_id = old.user_id and s.ended_at is null;
    perform public.log_event('timer.stop', old.user_id, null, null,
      jsonb_build_object('acc_ms', old.acc_ms, 'label', old.label));
  end if;
  return null;
exception when others then
  return null;                              -- a lost log line, never a lost timer
end $fn$;

drop trigger if exists live_timers_log on public.live_timers;
create trigger live_timers_log
  after insert or update or delete on public.live_timers
  for each row execute function public.trg_live_timers_log();

-- ------------------------------------------------------------
--  What an edit painted over, and what a delete took away.
--  The old row is kept whole, so a question nobody has asked yet
--  can still be answered.
-- ------------------------------------------------------------
create or replace function public.trg_sessions_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if tg_op = 'UPDATE' then
    if to_jsonb(new) - 'updated_at' is not distinct from to_jsonb(old) - 'updated_at' then
      return null;
    end if;
    perform public.log_event('session.edit', auth.uid(), new.user_id, new.id,
      jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new)));
  elsif tg_op = 'DELETE' then
    perform public.log_event('session.delete', auth.uid(), old.user_id, old.id,
      jsonb_build_object('row', to_jsonb(old)));
  end if;
  return null;
exception when others then return null;
end $fn$;

drop trigger if exists sessions_log on public.sessions;
create trigger sessions_log
  after update or delete on public.sessions
  for each row execute function public.trg_sessions_log();

-- ------------------------------------------------------------
--  Reactions, including the ones taken back — the table only
--  ever holds the current answer, so without this a change of
--  mind is invisible.
-- ------------------------------------------------------------
create or replace function public.trg_reactions_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare owner uuid;
begin
  if tg_op = 'DELETE' then
    perform public.log_event(tg_table_name || '.remove', old.user_id,
      case when tg_table_name = 'timer_reactions' then old.owner_id else null end,
      case when tg_table_name = 'session_reactions' then old.session_id else null end,
      jsonb_build_object('kind', old.kind));
  else
    perform public.log_event(tg_table_name || '.' || lower(tg_op), new.user_id,
      case when tg_table_name = 'timer_reactions' then new.owner_id else null end,
      case when tg_table_name = 'session_reactions' then new.session_id else null end,
      jsonb_build_object('kind', new.kind));
  end if;
  return null;
exception when others then return null;
end $fn$;

drop trigger if exists session_reactions_log on public.session_reactions;
create trigger session_reactions_log
  after insert or update or delete on public.session_reactions
  for each row execute function public.trg_reactions_log();

drop trigger if exists timer_reactions_log on public.timer_reactions;
create trigger timer_reactions_log
  after insert or update or delete on public.timer_reactions
  for each row execute function public.trg_reactions_log();

-- ------------------------------------------------------------
--  Profile changes, which is where private mode, display names
--  and mutes live. Skips the columns that move on their own.
-- ------------------------------------------------------------
create or replace function public.trg_profiles_log()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if to_jsonb(new) - 'updated_at' is not distinct from to_jsonb(old) - 'updated_at' then
    return null;
  end if;
  perform public.log_event('profile.edit', auth.uid(), new.id, new.id,
    jsonb_build_object('before', to_jsonb(old), 'after', to_jsonb(new)));
  return null;
exception when others then return null;
end $fn$;

drop trigger if exists profiles_log on public.profiles;
create trigger profiles_log
  after update on public.profiles
  for each row execute function public.trg_profiles_log();

-- ------------------------------------------------------------
--  Anything the app wants to record that no table sees: opening
--  the app, a tab, a nudge sent. Rate limited so a loop in a
--  browser cannot fill the table.
-- ------------------------------------------------------------
create or replace function public.note(kind text, data jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare recent int;
begin
  if auth.uid() is null then return; end if;
  if kind is null or length(kind) > 40 then return; end if;
  select count(*) into recent from public.events e
   where e.actor = auth.uid() and e.at > now() - interval '1 minute';
  if recent >= 30 then return; end if;
  perform public.log_event('app.' || kind, auth.uid(), null, null, data);
end $fn$;

revoke execute on function public.note(text, jsonb) from public, anon;
grant  execute on function public.note(text, jsonb) to authenticated;

-- ------------------------------------------------------------
--  Keeping it from growing forever. Spans are small and stay;
--  events are trimmed past a year and a bit, which covers a whole
--  HSC year with room either side.
-- ------------------------------------------------------------
create or replace function public.prune_events(keep_days int default 400)
returns int
language plpgsql
security definer
set search_path = public
as $fn$
declare n int;
begin
  delete from public.events where at < now() - (greatest(keep_days, 30) || ' days')::interval;
  get diagnostics n = row_count;
  return n;
end $fn$;

revoke all on function public.prune_events(int) from public, anon, authenticated;

-- Weekly, if pg_cron is there. It already is on this project — run_nudges uses
-- it — but a project without it just keeps everything, which breaks nothing.
do $$
begin
  perform cron.unschedule('prune-events');
exception when others then null;
end $$;
do $$
begin
  perform cron.schedule('prune-events', '17 4 * * 0', $c$select public.prune_events(400)$c$);
exception when others then null;
end $$;

-- ------------------------------------------------------------
--  Two views so the questions you actually have are one line.
-- ------------------------------------------------------------
create or replace view public.study_spans_done as
  select s.*,
         extract(epoch from (s.ended_at - s.started_at)) as wall_seconds,
         s.acc_ms / 1000.0                               as clock_seconds
    from public.study_spans s
   where s.ended_at is not null;

create or replace view public.live_by_hour as
  select date_trunc('hour', gs) as hour, count(*) as people
    from public.study_spans s,
         generate_series(date_trunc('hour', s.started_at),
                         date_trunc('hour', coalesce(s.ended_at, now())),
                         interval '1 hour') gs
   group by 1
   order by 1;

grant select on public.study_spans_done, public.live_by_hour to authenticated;

-- -------------------------------------------------------------------------
--  rpc() is answered from a cached picture of the schema, so a function made
--  a second ago can be real in Postgres and still missing from the API.
-- -------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- -------------------------------------------------------------------------
--  Every column should read true. Anything false is the thing to tell me.
-- -------------------------------------------------------------------------
select
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='send_announcement')                 as announcements,
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='react')                             as session_reactions,
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='react_timer')                       as timer_reactions,
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='note_live')                         as busyness_sampler,
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='live_history')                      as busyness_graph,
  (select count(*) = 2 from information_schema.tables
    where table_schema='public' and table_name in ('events','study_spans'))     as the_record,
  (select count(*) = 1 from pg_trigger where tgname = 'live_timers_log')         as span_trigger;
