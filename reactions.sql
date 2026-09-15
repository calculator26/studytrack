-- =========================================================================
--  REACTIONS — run this on its own
--  -----------------------------------------------------------------------
--  Also at the bottom of schema.sql. This copy exists because the SQL editor
--  runs a script as one transaction: one error anywhere aborts all of it and
--  you are shown only that first error, which is a bad way to find out that
--  the last block in an eleven-hundred-line file never ran.
--
--  Paste this in, run it, and the last line tells you whether it worked. It
--  needs public.sessions and public.is_admin() to exist, which they do if the
--  app works at all. Safe to run twice.
-- =========================================================================

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

-- The API answers rpc() from a cached picture of the schema, so a function
-- created a second ago can be real in Postgres and still missing from it.
notify pgrst, 'reload schema';

-- Should read: true | true | true
select
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'react')                        as react_fn,
  (select count(*) = 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reactions_for')                as reactions_for_fn,
  (select count(*) = 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'session_reactions')        as table_made;
