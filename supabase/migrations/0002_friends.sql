-- ---------------------------------------------------------------------------
-- rythm — real multi-user friends (migration 0002)
--
-- Run after 0001_init.sql in your Supabase project (SQL Editor).
--
-- Design:
--   * friend_requests — a pending/declined/accepted exchange between two users.
--   * friendships    — accepted pairs stored canonically (user_a < user_b) so
--                      each pair exists exactly once.
--   * profiles       — gains phone/avatar_url/goal so people can find each
--                      other and photos render.
--
-- Security: friend_requests and friendships have NO direct insert/update
-- policies. All writes go through security-definer RPCs (send/accept/decline)
-- that re-check auth.uid() inside the function. Reads are limited to your own
-- rows. Phone lookup sends only your contacts' numbers and gets back matches —
-- it never reveals anyone's phone number.
--
-- Note: profiles only exist for users who have opted into Cloud sync at least
-- once (upsertProfile runs on sync). Friend discovery therefore requires both
-- accounts to have synced — the app explains this in the Friends UI.
-- ---------------------------------------------------------------------------

-- --- Profiles: extra discovery/display columns -----------------------------
alter table public.profiles add column if not exists phone       text;
alter table public.profiles add column if not exists avatar_url  text;
alter table public.profiles add column if not exists goal        text;

-- --- Tables -----------------------------------------------------------------
create table if not exists public.friend_requests (
  id         uuid primary key default gen_random_uuid(),
  from_user  uuid not null references auth.users (id) on delete cascade,
  to_user    uuid not null references auth.users (id) on delete cascade,
  note       text,
  status     text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (from_user, to_user)
);

create table if not exists public.friendships (
  user_a     uuid not null references auth.users (id) on delete cascade,
  user_b     uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_a, user_b),
  check (user_a < user_b)
);

-- --- Row Level Security -----------------------------------------------------
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;

-- You can read requests you sent or received — nothing else.
drop policy if exists "requests_read_own" on public.friend_requests;
create policy "requests_read_own" on public.friend_requests
  for select
  using (auth.uid() = from_user or auth.uid() = to_user);

-- You can read your own friendships.
drop policy if exists "friendships_read_own" on public.friendships;
create policy "friendships_read_own" on public.friendships
  for select
  using (auth.uid() = user_a or auth.uid() = user_b);

-- No direct insert/update on either table: writes go through the RPCs below.

-- --- RPCs -------------------------------------------------------------------

-- Send a friend request by email. Resolves the email to a user id server-side,
-- so the client never learns more than it sends.
create or replace function public.send_friend_request(p_to_email text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me   uuid := auth.uid();
  them uuid;
  v_id uuid;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'error', 'Not signed in');
  end if;
  if p_to_email is null or trim(p_to_email) = '' then
    return jsonb_build_object('ok', false, 'error', 'Enter an email address.');
  end if;

  select id into them
  from auth.users
  where email = lower(trim(p_to_email));

  if them is null then
    return jsonb_build_object('ok', false, 'error', 'No rythm account found with that email.');
  end if;
  if them = me then
    return jsonb_build_object('ok', false, 'error', 'That''s you — you can''t friend yourself.');
  end if;
  if exists (
    select 1 from public.friendships f
    where (f.user_a = me and f.user_b = them) or (f.user_a = them and f.user_b = me)
  ) then
    return jsonb_build_object('ok', false, 'error', 'You''re already friends with them.');
  end if;
  if exists (
    select 1 from public.friend_requests r
    where r.status = 'pending'
      and ((r.from_user = me and r.to_user = them) or (r.from_user = them and r.to_user = me))
  ) then
    return jsonb_build_object('ok', false, 'error', 'A request is already pending with them.');
  end if;

  insert into public.friend_requests (from_user, to_user, note)
  values (me, them, p_note)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- Accept a request you received: flips it to accepted and creates the pair.
create or replace function public.accept_friend_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me     uuid := auth.uid();
  v_from uuid;
  v_to   uuid;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'error', 'Not signed in');
  end if;

  select from_user, to_user into v_from, v_to
  from public.friend_requests
  where id = p_request_id and status = 'pending';

  if v_to is null then
    return jsonb_build_object('ok', false, 'error', 'Request not found.');
  end if;
  if v_to <> me then
    return jsonb_build_object('ok', false, 'error', 'Not your request to accept.');
  end if;

  update public.friend_requests
  set status = 'accepted', updated_at = now()
  where id = p_request_id;

  insert into public.friendships (user_a, user_b)
  values (least(v_from, v_to), greatest(v_from, v_to))
  on conflict do nothing;

  return jsonb_build_object('ok', true);
end;
$$;

-- Decline a request you received.
create or replace function public.decline_friend_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  me   uuid := auth.uid();
  v_to uuid;
begin
  if me is null then
    return jsonb_build_object('ok', false, 'error', 'Not signed in');
  end if;

  select to_user into v_to
  from public.friend_requests
  where id = p_request_id and status = 'pending';

  if v_to is null then
    return jsonb_build_object('ok', false, 'error', 'Request not found.');
  end if;
  if v_to <> me then
    return jsonb_build_object('ok', false, 'error', 'Not your request to decline.');
  end if;

  update public.friend_requests
  set status = 'declined', updated_at = now()
  where id = p_request_id;

  return jsonb_build_object('ok', true);
end;
$$;

-- Your accepted friends, with their public profile info.
create or replace function public.friends_of()
returns table (id uuid, email text, name text, avatar_url text, goal text, joined_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select p.id, p.email, p.name, p.avatar_url, p.goal, p.created_at
  from public.friendships f
  join public.profiles p
    on p.id = case when f.user_a = auth.uid() then f.user_b else f.user_a end
  where f.user_a = auth.uid() or f.user_b = auth.uid()
  order by p.name;
$$;

-- Incoming pending requests (with the sender's profile).
create or replace function public.incoming_requests()
returns table (id uuid, from_user uuid, email text, name text, avatar_url text, note text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select r.id, p.id, p.email, p.name, p.avatar_url, r.note, r.created_at
  from public.friend_requests r
  join public.profiles p on p.id = r.from_user
  where r.to_user = auth.uid() and r.status = 'pending'
  order by r.created_at desc;
$$;

-- Outgoing pending requests (with the target's profile).
create or replace function public.outgoing_requests()
returns table (id uuid, to_user uuid, email text, name text, avatar_url text, note text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select r.id, p.id, p.email, p.name, p.avatar_url, r.note, r.created_at
  from public.friend_requests r
  join public.profiles p on p.id = r.to_user
  where r.from_user = auth.uid() and r.status = 'pending'
  order by r.created_at desc;
$$;

-- Directory search by name or email (never reveals phone numbers).
create or replace function public.search_users(p_q text)
returns table (id uuid, email text, name text, avatar_url text, goal text)
language sql
security definer
set search_path = public
as $$
  select p.id, p.email, p.name, p.avatar_url, p.goal
  from public.profiles p
  where (p.name ilike '%' || p_q || '%' or p.email ilike '%' || p_q || '%')
    and p.id <> auth.uid()
  order by p.name
  limit 20;
$$;

-- Phone lookup: pass the normalized digits of your contacts' numbers, get back
-- the profiles that match. Only ever returns matches — never a phone number.
create or replace function public.lookup_phones(p_phones text[])
returns table (id uuid, email text, name text, avatar_url text, goal text)
language sql
security definer
set search_path = public
as $$
  select p.id, p.email, p.name, p.avatar_url, p.goal
  from public.profiles p
  where p.phone is not null
    and regexp_replace(p.phone, '\D', '', 'g') = any (
      select regexp_replace(x, '\D', '', 'g') from unnest(p_phones) x
    )
    and p.id <> auth.uid();
$$;

-- Remove an existing friendship (either side can do it).
create or replace function public.remove_friend(p_friend_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'Not signed in');
  end if;

  delete from public.friendships f
  where (f.user_a = auth.uid() and f.user_b = p_friend_id)
     or (f.user_a = p_friend_id and f.user_b = auth.uid());

  if not found then
    return jsonb_build_object('ok', false, 'error', 'Not friends.');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
