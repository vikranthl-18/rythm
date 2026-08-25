-- ---------------------------------------------------------------------------
-- rythm — initial Supabase schema
--
-- Run this in your Supabase project (Dashboard → SQL Editor → New query) once.
-- Row Level Security is ON everywhere: every row is owned by auth.uid(), so
-- the public anon key can never read or write another user's data.
--
-- The app is local-first: these tables only come into play when a user opts
-- into Cloud sync in Settings. A "snapshot" is the user's full local state
-- (metrics, workouts, habits, friends) stored as JSONB — the portable,
-- versioned blob the device pushes and pulls. Cloud-wins/last-write-wins by
-- updated_at; the local device keeps working offline and re-syncs on the
-- next load.
-- ---------------------------------------------------------------------------

-- Account profile (mirrors the local onboarding details).
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  email      text,
  name       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Full user state snapshot (opt-in cloud backup / sync).
create table if not exists public.user_snapshots (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  data           jsonb not null,
  schema_version integer not null default 1,
  updated_at     timestamptz not null default now()
);

-- Row Level Security — each user sees only their own rows.
alter table public.profiles enable row level security;
alter table public.user_snapshots enable row level security;

drop policy if exists "profiles_own" on public.profiles;
create policy "profiles_own" on public.profiles
  for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

drop policy if exists "snapshots_own" on public.user_snapshots;
create policy "snapshots_own" on public.user_snapshots
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
