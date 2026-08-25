-- ---------------------------------------------------------------------------
-- rythm — cloud profile fields (migration 0004)
--
-- Run after 0001_init.sql / 0002_friends.sql in your Supabase project
-- (Dashboard → SQL Editor → New query).
--
-- Onboarding + profile used to live only in localStorage, so a returning
-- user on a NEW device (fresh browser, or the APK's webview) was wrongly
-- forced through first-run setup again. These columns mirror the local
-- profile to the account row; the app restores them on sign-in and skips
-- onboarding for anyone who already completed it.
--
-- Migration 0003 (health_samples) is unrelated and can be run in any order.
-- ---------------------------------------------------------------------------

alter table public.profiles add column if not exists birthday            text;
alter table public.profiles add column if not exists sex                text;
alter table public.profiles add column if not exists weight_kg          numeric;
alter table public.profiles add column if not exists height_cm          numeric;
alter table public.profiles add column if not exists age                integer;
alter table public.profiles add column if not exists profile_created_at timestamptz;
