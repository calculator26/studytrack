-- =========================================================================
--  ANNOUNCEMENTS — run this on its own
--  -----------------------------------------------------------------------
--  Everything in here is also at the bottom of schema.sql. This file exists
--  because of how the SQL editor runs a script: the whole thing is one
--  transaction, so a single error anywhere aborts all of it, and the editor
--  shows you only that first error. The announcements block sits at the end
--  of an eleven-hundred-line file, which makes it the first thing to be lost
--  and the last thing you would think to check — the symptom being an app
--  that says
--
--    Could not find the function public.send_announcement(...)
--    in the schema cache
--
--  while the SQL looks like it ran.
--
--  So: paste THIS file into the Supabase SQL editor and run it. It touches
--  nothing but the announcement feature, it is safe to run twice, and it
--  works whether or not you ever ran the earlier one-argument version.
--
--  It needs public.messages and public.profiles to exist already, which they
--  will if the app's chat has ever worked.
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

-- -------------------------------------------------------------------------
--  Tell the API it exists.
--
--  sb.rpc() is answered from a cached picture of the schema rather than from
--  the database, so a function created a second ago can be real in Postgres
--  and still missing from the API. This is the line that closes that gap.
-- -------------------------------------------------------------------------
notify pgrst, 'reload schema';

-- -------------------------------------------------------------------------
--  Say so, out loud, so the editor's output tells you it worked rather than
--  leaving you to guess. One row, three columns, all of which should read
--  true / the new signature / 1.
-- -------------------------------------------------------------------------
select
  (select count(*) = 1
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'send_announcement')          as exactly_one_send_announcement,
  (select pg_get_function_identity_arguments(p.oid)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'send_announcement')          as signature,
  (select count(*)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'messages'
      and column_name in ('announcement','ann_label'))                       as columns_added;
