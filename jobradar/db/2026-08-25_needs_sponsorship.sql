-- Applied to the jobradar Supabase project 2026-08-25 (recorded here for
-- anyone self-hosting). An F-1/OPT student's daily list must never contain
-- a posting that states it cannot sponsor.
alter table jr_user_profiles
  add column if not exists needs_sponsorship boolean not null default false;
