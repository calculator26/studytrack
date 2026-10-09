-- =========================================================================
--  LIMITS — how long anything people type can be
--  -----------------------------------------------------------------------
--  On 9 Oct 2026 an account set its name to 99,999 characters of lorem
--  ipsum, and every leaderboard, chat line and live card drew all of it for
--  everyone. The app's boxes have limits, but the database took anything sent
--  to it directly. These checks are the real limit, whatever sends the row.
--  Each is well above the longest real value at the time. Safe to re-run.
-- =========================================================================

-- Sign-up names come from what was typed at sign-up: trimmed and cut to fit,
-- so a long one makes a shorter name rather than a failed sign-up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare nm text;
begin
  nm := left(btrim(regexp_replace(coalesce(new.raw_user_meta_data->>'display_name', ''), '\s+', ' ', 'g')), 48);
  if nm = '' then nm := left(split_part(new.email, '@', 1), 48); end if;
  if nm = '' then nm := 'New member'; end if;
  insert into public.profiles (id, display_name) values (new.id, nm)
  on conflict (id) do nothing;
  return new;
end $$;

do $$
declare c record;
begin
  for c in select * from (values
    ('profiles',     'profiles_name_len',      'char_length(btrim(display_name)) between 1 and 48'),
    ('profiles',     'profiles_avatar_len',    'avatar_url is null or char_length(avatar_url) <= 500'),
    ('profiles',     'profiles_colour_hex',    'colour is null or colour ~ ''^#[0-9A-Fa-f]{6}$'''),
    ('subjects',     'subjects_name_len',      'char_length(name) between 1 and 80'),
    ('subjects',     'subjects_colour_hex',    'colour is null or colour ~ ''^#[0-9A-Fa-f]{6}$'''),
    ('areas',        'areas_name_len',         'char_length(name) between 1 and 120'),
    ('sessions',     'sessions_note_len',      'note is null or char_length(note) <= 1000'),
    ('sessions',     'sessions_mode_len',      'mode is null or char_length(mode) <= 30'),
    ('live_timers',  'live_timers_label_len',  'label is null or char_length(label) <= 200'),
    ('messages',     'messages_body_len',      'char_length(body) <= 2000'),
    ('messages',     'messages_ann_label_len', 'ann_label is null or char_length(ann_label) <= 60'),
    ('study_spans',  'study_spans_label_len',  'label is null or char_length(label) <= 200')
  ) v(tbl, con, chk) loop
    if to_regclass('public.' || c.tbl) is not null
       and not exists (select 1 from pg_constraint where conname = c.con) then
      execute format('alter table public.%I add constraint %I check (%s)', c.tbl, c.con, c.chk);
    end if;
  end loop;
end $$;
