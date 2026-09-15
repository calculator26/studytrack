-- =========================================================================
--  MIGRATE — everything added since the last time you ran schema.sql
--  -----------------------------------------------------------------------
--  Paste the whole file into the Supabase SQL editor and run it. That is the
--  only step; there is nothing to do afterwards.
--
--  Why this file exists rather than "just re-run schema.sql": the editor runs
--  a script as one transaction and aborts on the first error, showing you only
--  that error. New work lands at the bottom of an eleven-hundred-line file, so
--  it is the first thing lost to an unrelated failure anywhere above it and
--  the last place anyone thinks to look. This is short enough to fail loudly.
--
--  Safe to run as many times as you like. Every statement is written to be
--  repeatable, and the last one prints whether it worked.
--
--  Needs public.sessions, public.messages, public.live_timers, public.profiles
--  and public.is_admin() to exist, which they do if the app runs at all.
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

-- -------------------------------------------------------------------------
--  The API answers rpc() from a cached picture of the schema, so a function
--  created a second ago can be real in Postgres and still missing from it.
-- -------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- -------------------------------------------------------------------------
--  Every column should read true. Anything false is the thing to tell me.
-- -------------------------------------------------------------------------
select
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'send_announcement')      as announcements,
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'react')                  as session_reactions,
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reactions_for')          as reaction_counts,
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'react_timer')            as timer_reactions,
  (select count(*) = 2 from information_schema.columns
    where table_schema = 'public' and table_name = 'messages'
      and column_name in ('announcement','ann_label'))                   as announcement_columns;
