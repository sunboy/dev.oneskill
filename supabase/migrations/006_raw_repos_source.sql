-- ============================================================================
-- Add source column to raw_repos for multi-source discovery
-- Sources: github (Search API), npm, pypi, awesome-list
-- ============================================================================

ALTER TABLE raw_repos ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'github';

CREATE INDEX IF NOT EXISTS idx_raw_repos_source ON raw_repos(source);

-- Composite index for per-source queries
CREATE INDEX IF NOT EXISTS idx_raw_repos_source_status
  ON raw_repos(source, enrichment_status)
  WHERE enrichment_status IN ('pending', 'failed');
