-- ============================================================================
-- OneSkill: Performance indexes for common query patterns
-- Run this in the Supabase SQL Editor after 001_fix_constraints.sql
-- ============================================================================

-- Index for trending sort (homepage, explore default)
CREATE INDEX IF NOT EXISTS idx_artifacts_trending
  ON public.artifacts (trending_score DESC)
  WHERE status = 'active';

-- Index for recently updated sort
CREATE INDEX IF NOT EXISTS idx_artifacts_updated
  ON public.artifacts (github_updated_at DESC)
  WHERE status = 'active';

-- Index for featured artifacts (homepage)
CREATE INDEX IF NOT EXISTS idx_artifacts_featured
  ON public.artifacts (trending_score DESC)
  WHERE status = 'active' AND is_featured = true;

-- Index for category filtering
CREATE INDEX IF NOT EXISTS idx_artifacts_category
  ON public.artifacts (category_id)
  WHERE status = 'active';

-- Index for type filtering
CREATE INDEX IF NOT EXISTS idx_artifacts_type
  ON public.artifacts (artifact_type_id)
  WHERE status = 'active';

-- Index for contributor lookup
CREATE INDEX IF NOT EXISTS idx_artifacts_contributor
  ON public.artifacts (contributor_id)
  WHERE status = 'active' AND contributor_id IS NOT NULL;

-- Unique constraint on contributors github_username (for upsert)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.contributors'::regclass
      AND conname = 'contributors_github_username_key'
  ) THEN
    ALTER TABLE public.contributors
      ADD CONSTRAINT contributors_github_username_key
      UNIQUE (github_username);
  END IF;
END $$;

-- Composite unique on artifact_platforms junction (for upsert)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.artifact_platforms'::regclass
      AND conname = 'artifact_platforms_artifact_id_platform_id_key'
  ) THEN
    ALTER TABLE public.artifact_platforms
      ADD CONSTRAINT artifact_platforms_artifact_id_platform_id_key
      UNIQUE (artifact_id, platform_id);
  END IF;
END $$;
