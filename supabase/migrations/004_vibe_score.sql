-- ============================================================================
-- OneSkill: Vibe Score — social signal aggregation
-- ============================================================================

-- 1. Add vibe-score columns to artifacts table
ALTER TABLE public.artifacts
  ADD COLUMN IF NOT EXISTS vibe_score         INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS npm_downloads_weekly  INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pypi_downloads_weekly INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mention_count_7d   INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mention_count_30d  INT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS sentiment_avg      REAL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vibe_updated_at    TIMESTAMPTZ;

-- 2. Mentions table — raw social signal data
CREATE TABLE IF NOT EXISTS artifact_mentions (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  artifact_id   UUID NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
  source        TEXT NOT NULL CHECK (source IN (
    'hackernews', 'reddit', 'devto', 'hashnode', 'stackoverflow', 'github_discussions'
  )),
  external_id   TEXT,            -- source-specific ID for dedup
  title         TEXT,
  url           TEXT,
  author        TEXT,
  score         INT DEFAULT 0,   -- upvotes/points from source
  comment_count INT DEFAULT 0,
  sentiment     REAL,            -- -1.0 to 1.0 (from Gemini)
  snippet       TEXT,            -- first 500 chars of content
  mentioned_at  TIMESTAMPTZ NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now(),

  UNIQUE (source, external_id)
);

-- 3. Indexes for mentions
CREATE INDEX IF NOT EXISTS idx_mentions_artifact
  ON artifact_mentions(artifact_id);
CREATE INDEX IF NOT EXISTS idx_mentions_source
  ON artifact_mentions(source, mentioned_at DESC);
CREATE INDEX IF NOT EXISTS idx_mentions_recent
  ON artifact_mentions(mentioned_at DESC);

-- 4. Index for vibe score sort
CREATE INDEX IF NOT EXISTS idx_artifacts_vibe
  ON public.artifacts(vibe_score DESC)
  WHERE status = 'active';

-- 5. RLS for artifact_mentions
ALTER TABLE artifact_mentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access on artifact_mentions"
  ON artifact_mentions FOR SELECT USING (true);

CREATE POLICY "Service role full access on artifact_mentions"
  ON artifact_mentions FOR ALL USING (true) WITH CHECK (true);
