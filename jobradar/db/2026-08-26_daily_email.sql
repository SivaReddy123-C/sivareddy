-- Applied to the jobradar Supabase project 2026-08-26. Opt-in daily digest:
-- the ranked list lands in the inbox so the session ends before it starts.
-- Default false -- "never nagged" is a README principle.
alter table jr_user_profiles
  add column if not exists daily_email boolean not null default false;
