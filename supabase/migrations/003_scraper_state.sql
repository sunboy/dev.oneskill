-- Scraper state table for tracking cursor/resume across bulk runs
CREATE TABLE IF NOT EXISTS scraper_state (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  query_key   TEXT NOT NULL UNIQUE,
  last_page   INT DEFAULT 0,
  last_bucket_idx INT DEFAULT 0,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_scraper_state_query_key ON scraper_state(query_key);

-- Grant access to the service role
ALTER TABLE scraper_state ENABLE ROW LEVEL SECURITY;

-- Allow service role full access
CREATE POLICY "Service role full access on scraper_state"
  ON scraper_state
  FOR ALL
  USING (true)
  WITH CHECK (true);
