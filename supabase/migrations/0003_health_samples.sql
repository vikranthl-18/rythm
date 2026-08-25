-- ---------------------------------------------------------------------------
-- rythm — native health samples (migration 0003)
--
-- The native tester build reads HealthKit / Health Connect and pushes
-- per-day sample batches here (one row per (date, source, metric)). This is
-- the bridge between the native app's wearable data and the web app's merge
-- engine: the web app can pull these rows and feed them into the same
-- priority-merge rules as its simulated devices.
--
-- Run after 0001_init.sql and 0002_friends.sql.
-- ---------------------------------------------------------------------------

create table if not exists public.health_samples (
  user_id    uuid not null references auth.users (id) on delete cascade,
  date       text not null,          -- local YYYY-MM-DD of the measurement
  source     text not null,          -- device slot id, e.g. 'apple-watch'
  metric     text not null,          -- 'hr' | 'steps' | 'sleep' | 'hrv' | ...
  samples    jsonb not null,         -- [{ "t": minutes-since-midnight, "value": number }]
  updated_at timestamptz not null default now(),
  primary key (user_id, date, source, metric)
);

alter table public.health_samples enable row level security;

drop policy if exists "health_samples_own" on public.health_samples;
create policy "health_samples_own" on public.health_samples
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Upsert helper used by the native app (and the web app when it pulls).
create or replace function public.upsert_health_samples(
  p_date    text,
  p_source  text,
  p_metric  text,
  p_samples jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'Not signed in');
  end if;
  insert into public.health_samples (user_id, date, source, metric, samples, updated_at)
  values (auth.uid(), p_date, p_source, p_metric, p_samples, now())
  on conflict (user_id, date, source, metric)
  do update set samples = excluded.samples, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;
