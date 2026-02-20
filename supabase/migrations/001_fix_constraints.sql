-- ============================================================================
-- OneSkill: Fix constraints for scraper pipeline
-- Run this in the Supabase SQL Editor (Dashboard → SQL → New query)
-- ============================================================================

-- 1. DIAGNOSE: Show current check constraint definition
--    (Run this first to see what values are currently allowed)
SELECT
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.artifacts'::regclass
  AND contype = 'c';

-- 2. DIAGNOSE: Show all unique/primary key constraints on artifacts
SELECT
  conname AS constraint_name,
  contype AS type,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.artifacts'::regclass
  AND contype IN ('u', 'p');

-- ============================================================================
-- After running the above diagnostics, run the fixes below:
-- ============================================================================

-- 3. FIX: Drop the restrictive source check constraint
ALTER TABLE public.artifacts
  DROP CONSTRAINT IF EXISTS artifacts_source_check;

-- 4. FIX: Re-add source check with values we need
ALTER TABLE public.artifacts
  ADD CONSTRAINT artifacts_source_check
  CHECK (source IN ('github_scraper', 'manual', 'submission', 'import', 'mock'));

-- 5. FIX: Add unique constraint on github_repo_full_name for upsert support
--    (only if it doesn't already exist)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.artifacts'::regclass
      AND conname = 'artifacts_github_repo_full_name_key'
  ) THEN
    ALTER TABLE public.artifacts
      ADD CONSTRAINT artifacts_github_repo_full_name_key
      UNIQUE (github_repo_full_name);
  END IF;
END $$;

-- 6. FIX: Add unique constraint on slug for URL routing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.artifacts'::regclass
      AND conname = 'artifacts_slug_key'
  ) THEN
    ALTER TABLE public.artifacts
      ADD CONSTRAINT artifacts_slug_key
      UNIQUE (slug);
  END IF;
END $$;

-- 7. VERIFY: Show updated constraints
SELECT
  conname AS constraint_name,
  contype AS type,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.artifacts'::regclass
ORDER BY contype, conname;
