-- =========================================================================
--  ip_ban: shut a network out, but not the people who live on it
--  (28 Oct 2026)
--  -----------------------------------------------------------------------
--  Run after kick.sql and signup_log.sql. The fake accounts all come from
--  one home connection that a real member also uses, so a plain IP ban
--  would lock him out too. Three layers:
--
--   * banned_networks: addresses (or ranges) that are shut out.
--   * network_exempt: accounts that may still use the app from one.
--   * kick_check (the pre-request hook) refuses every signed-in request
--     from a banned network unless the account is exempt, so a fake
--     account made there is useless the moment it signs in. Signed-out
--     requests still pass, so the sign-up page can be told why.
--   * signup_check says no to a sign-up from a banned network.
--   * hook_signup_network is for Supabase Auth's "Before User Created"
--     hook, which sees the real IP even if the page is skipped. It only
--     works once switched on: Dashboard > Authentication > Hooks > Before
--     User Created > Postgres > public.hook_signup_network.
--
--      insert into public.banned_networks(cidr, note) values ('1.2.3.4/32', 'why');
--      insert into public.network_exempt(user_id, note) values ('<uuid>', 'who');
--  Owner-only tables. Safe to re-run.
-- =========================================================================
create table if not exists public.banned_networks (
  cidr     cidr primary key,
  note     text,
  added_at timestamptz not null default now()
);
alter table public.banned_networks enable row level security;
revoke all on public.banned_networks from anon, authenticated;
grant select on public.banned_networks to supabase_auth_admin;

create table if not exists public.network_exempt (
  user_id  uuid primary key,
  note     text,
  added_at timestamptz not null default now()
);
alter table public.network_exempt enable row level security;
revoke all on public.network_exempt from anon, authenticated;

insert into public.banned_networks (cidr, note) values
  ('122.106.171.180/32', 'the troll''s connection (Optus home), every fake account since 22 Oct')
on conflict (cidr) do nothing;
insert into public.network_exempt (user_id, note) values
  ('da38c037-80f0-4279-8633-069971ac117a', 'a real member on the same home connection')
on conflict (user_id) do nothing;

create or replace function public.network_banned(addr text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare ip inet;
begin
  begin ip := btrim(addr)::inet; exception when others then return false; end;
  return ip is not null and exists (select 1 from public.banned_networks b where ip <<= b.cidr);
end $$;
revoke all on function public.network_banned(text) from public, anon, authenticated;

create or replace function public.request_ip()
returns text
language sql
stable
as $$
  with h as (select coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb h)
  select coalesce(h->>'cf-connecting-ip', btrim(split_part(h->>'x-forwarded-for', ',', 1)), h->>'x-real-ip') from h
$$;

/* kick.sql's check, plus the network ban */
create or replace function public.kick_check()
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  claims jsonb := nullif(current_setting('request.jwt.claims', true), '')::jsonb;
  sid text := claims ->> 'session_id';
  sub text := claims ->> 'sub';
begin
  if sid is not null and exists (select 1 from public.kicked_sessions where session_id = sid::uuid) then
    raise sqlstate 'PT401' using message = 'Signed out', detail = 'This session was ended by an admin.';
  end if;
  if sub is not null and public.network_banned(public.request_ip())
     and not exists (select 1 from public.network_exempt e where e.user_id::text = sub) then
    raise sqlstate 'PT403' using message = 'Blocked', detail = 'Study Track is not available from this network.';
  end if;
end $$;
grant execute on function public.kick_check() to anon, authenticated;

/* the sign-up page asks first; a banned network gets a no */
create or replace function public.signup_check(email text, name text, info jsonb default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v jsonb := public.signup_verdict(email, name);
  h jsonb := coalesce(nullif(current_setting('request.headers', true), ''), '{}')::jsonb;
  ip text := coalesce(h->>'cf-connecting-ip', btrim(split_part(h->>'x-forwarded-for', ',', 1)), h->>'x-real-ip');
begin
  if public.network_banned(ip) then
    v := jsonb_build_object('ok', false, 'why', 'Sign-ups are not available from this network.');
  end if;
  delete from public.signup_log where at < now() - interval '180 days';
  insert into public.signup_log (email, name, ok, why, ip, user_agent, country, language, headers, client)
  values (left(email, 320), left(name, 100), (v->>'ok')::boolean, v->>'why', ip,
          left(h->>'user-agent', 500), h->>'cf-ipcountry', left(h->>'accept-language', 200),
          h - 'authorization' - 'apikey' - 'cookie',
          case when info is not null and pg_column_size(info) <= 4000 then info end);
  return v;
end $$;
revoke all on function public.signup_check(text, text, jsonb) from public;
grant execute on function public.signup_check(text, text, jsonb) to anon, authenticated;

/* Supabase Auth's Before User Created hook (switch it on in the dashboard) */
create or replace function public.hook_signup_network(event jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if public.network_banned(event->'metadata'->>'ip_address') then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Sign-ups are not available from this network.'));
  end if;
  return '{}'::jsonb;
end $$;
revoke execute on function public.hook_signup_network(jsonb) from public, anon, authenticated;
grant execute on function public.hook_signup_network(jsonb) to supabase_auth_admin;

notify pgrst, 'reload config';
