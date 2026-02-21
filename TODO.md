# OneSkill.dev — TODO

## Scraper Pipeline (v4 Two-Phase)

- [ ] Run `005_raw_repos_staging.sql` migration in Supabase (if not done)
- [x] Run discover mode — repos saved to `raw_repos` staging table
- [ ] Run `--enrich` mode via GitHub Actions to process pending repos through Gemini
- [ ] Run `003_scraper_state.sql` migration in Supabase (if not done)
- [ ] Run `004_vibe_score.sql` migration in Supabase (if not done)
- [ ] Trigger first vibe score run via GitHub Actions → "Compute Vibe Scores" → Run workflow
- [ ] Verify Vercel deployment shows real data after enrichment populates `artifacts` table

## Vibe Score Pipeline — Additional Signal Sources

- [ ] **GitHub Discussions** — search discussions/issues mentioning artifacts via GraphQL API (free, PAT already available, 5k req/hr)
- [ ] **Hashnode** — blog post mentions via GraphQL API (free, ~2k req/min unauthenticated)
- [ ] **Stack Overflow** — question/answer mentions via Stack Exchange API (free with API key)
- [ ] **Reddit** — needs `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` in GitHub Actions secrets (free "script" app at reddit.com/prefs/apps). Pipeline skips Reddit gracefully if not set.

## Frontend (Completed)

- [x] VibeRing, SignalChips, MentionCard, VibePanel, DownloadPulse components
- [x] Vibe score on detail page sidebar + SignalChips below description
- [x] VibeRing + DownloadPulse + SignalChips on homepage featured cards
- [x] "Vibe" sort option on explore page

## Differentiation Features (Future)

- [ ] **Artifact Stacks / "Works well with"** — scrape public repos that import multiple artifacts together, surface combos ("people who use X also use Y")
- [ ] **Real usage examples** — scrape actual configs from public GitHub repos (`.cursor/rules`, `claude_code_config.json`, n8n workflow JSONs)
- [ ] **Maintenance health score** — issue response time, PR merge velocity, contributor count, last commit recency (all from GitHub API)
- [ ] **One-click install** — deep links into IDE extensions for instant artifact installation
- [ ] **Community curation** — let users submit their own stacks/combos, upvote artifacts, leave reviews
