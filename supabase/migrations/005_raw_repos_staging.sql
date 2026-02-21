-- ============================================================================
-- OneSkill: Raw repos staging table for 2-phase scraper
-- Phase 1 (discover): GitHub search → raw_repos (no Gemini needed)
-- Phase 2 (enrich):   raw_repos → Gemini → artifacts (retryable)
-- ============================================================================

-- 1. Staging table for discovered repos
CREATE TABLE IF NOT EXISTS raw_repos (
  id                UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  github_full_name  TEXT NOT NULL UNIQUE,
  owner_login       TEXT NOT NULL,
  repo_name         TEXT NOT NULL,
  description       TEXT,
  language          TEXT,
  stars             INT DEFAULT 0,
  forks             INT DEFAULT 0,
  open_issues       INT DEFAULT 0,
  license           TEXT,
  default_branch    TEXT DEFAULT 'main',
  topics            JSONB DEFAULT '[]',
  github_url        TEXT,
  owner_avatar_url  TEXT,
  owner_html_url    TEXT,
  github_created_at TIMESTAMPTZ,
  github_updated_at TIMESTAMPTZ,
  readme_raw        TEXT,                           -- full README content
  type_hint         TEXT NOT NULL,                   -- scraper hint (mcp-server, skill, etc.)

  -- Enrichment tracking
  enrichment_status TEXT NOT NULL DEFAULT 'pending'  -- pending | enriched | failed | skipped
    CHECK (enrichment_status IN ('pending', 'enriched', 'failed', 'skipped')),
  enrichment_error  TEXT,                            -- last error message if failed
  enrich_attempts   INT DEFAULT 0,                   -- retry counter
  enriched_at       TIMESTAMPTZ,                     -- when last enrichment succeeded
  artifact_id       UUID REFERENCES artifacts(id),   -- link to created artifact

  discovered_at     TIMESTAMPTZ DEFAULT now(),
  updated_at        TIMESTAMPTZ DEFAULT now()
);

-- 2. Indexes
CREATE INDEX IF NOT EXISTS idx_raw_repos_status
  ON raw_repos(enrichment_status)
  WHERE enrichment_status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS idx_raw_repos_fullname
  ON raw_repos(github_full_name);

CREATE INDEX IF NOT EXISTS idx_raw_repos_hint
  ON raw_repos(type_hint);

CREATE INDEX IF NOT EXISTS idx_raw_repos_stars
  ON raw_repos(stars DESC);

-- 3. RLS
ALTER TABLE raw_repos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on raw_repos"
  ON raw_repos FOR ALL USING (true) WITH CHECK (true);
