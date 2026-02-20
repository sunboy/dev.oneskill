# OneSkill.dev — TODO

## Vibe Score Pipeline — Additional Signal Sources

- [ ] **GitHub Discussions** — search discussions/issues mentioning artifacts via GraphQL API (free, PAT already available, 5k req/hr)
- [ ] **Hashnode** — blog post mentions via GraphQL API (free, ~2k req/min unauthenticated)
- [ ] **Stack Overflow** — question/answer mentions via Stack Exchange API (free with API key)
- [ ] **Reddit** — needs `REDDIT_CLIENT_ID` + `REDDIT_CLIENT_SECRET` in GitHub Actions secrets (free "script" app at reddit.com/prefs/apps). Pipeline skips Reddit gracefully if not set.

## Scraper

- [ ] Run `003_scraper_state.sql` migration in Supabase
- [ ] Run `004_vibe_score.sql` migration in Supabase
- [ ] Trigger first bulk scrape via GitHub Actions → "Scrape GitHub for Agent Artifacts" → Run workflow → select **bulk**
- [ ] Trigger first vibe score run via GitHub Actions → "Compute Vibe Scores" → Run workflow
- [ ] Verify Vercel deployment shows real data after bulk scrape populates DB

## Differentiation Features (Future)

- [ ] **Artifact Stacks / "Works well with"** — scrape public repos that import multiple artifacts together, surface combos ("people who use X also use Y")
- [ ] **Real usage examples** — scrape actual configs from public GitHub repos (`.cursor/rules`, `claude_code_config.json`, n8n workflow JSONs)
- [ ] **Maintenance health score** — issue response time, PR merge velocity, contributor count, last commit recency (all from GitHub API)
- [ ] **One-click install** — deep links into IDE extensions for instant artifact installation
- [ ] **Community curation** — let users submit their own stacks/combos, upvote artifacts, leave reviews

## Frontend

- [ ] Display vibe score on artifact cards and detail pages
- [ ] Add "Trending" sort option using vibe_score
- [ ] Show mention sources (HN, Reddit, Dev.to icons) on artifact detail page
- [ ] Sentiment badge (positive/neutral/negative) on artifact cards
