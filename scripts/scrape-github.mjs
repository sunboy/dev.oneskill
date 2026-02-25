#!/usr/bin/env node

/**
 * OneSkill GitHub Artifact Scraper  v4
 *
 * Two-phase architecture — discover first, enrich later.
 * Each phase is independent and retryable.
 *
 * Modes:
 *   --discover       : Phase 1. GitHub Search → fetch READMEs → save to raw_repos table.
 *                      No Gemini needed. Safe to run repeatedly (upserts by full_name).
 *
 *   --enrich         : Phase 2. Pick unenriched rows from raw_repos → Gemini → upsert
 *                      to artifacts table. Retryable — failed rows get retried next run.
 *                      --enrich-limit N  : max repos to enrich per run (default: 200)
 *
 *   --bulk           : Combined discover+enrich for full index (backward compat).
 *                      Runs discover first (all queries), then enriches everything.
 *
 *   (default)        : Incremental discover (recent repos) + enrich pending.
 *
 * Supabase tables:
 *   raw_repos              – staging table (Phase 1 output, Phase 2 input)
 *   artifact_types, categories, platforms – lookups
 *   contributors           – upsert by github_username
 *   artifacts              – main table (Phase 2 output)
 *   artifact_platforms     – junction table
 *   scraper_state          – cursor/offset tracking per query
 */

// ─────────────────────────── CLI flags ───────────────────────────

const FLAGS = {
  discover:     process.argv.includes('--discover'),
  enrich:       process.argv.includes('--enrich'),
  bulk:         process.argv.includes('--bulk'),
};
// If none specified, default to incremental (discover recent + enrich pending)
const IS_INCREMENTAL = !FLAGS.discover && !FLAGS.enrich && !FLAGS.bulk;

const ENRICH_LIMIT_ARG = process.argv.indexOf('--enrich-limit');
const ENRICH_LIMIT = ENRICH_LIMIT_ARG !== -1
  ? parseInt(process.argv[ENRICH_LIMIT_ARG + 1], 10) || 1500
  : 1500;

// --type <slug>  : filter discover queries to only this artifact type
const TYPE_ARG = process.argv.indexOf('--type');
const TYPE_FILTER = TYPE_ARG !== -1 ? process.argv[TYPE_ARG + 1] : null;

// --discover-limit N : cap how many repos to discover per run (default: no cap)
const DISCOVER_LIMIT_ARG = process.argv.indexOf('--discover-limit');
const DISCOVER_LIMIT = DISCOVER_LIMIT_ARG !== -1
  ? parseInt(process.argv[DISCOVER_LIMIT_ARG + 1], 10) || 300
  : 0;   // 0 = no cap unless explicitly set

// --time-budget M : gracefully stop discovery after M minutes, flush & exit clean.
// This prevents hard timeout kills that lose in-flight work.
const TIME_BUDGET_ARG = process.argv.indexOf('--time-budget');
const TIME_BUDGET_MIN = TIME_BUDGET_ARG !== -1
  ? parseInt(process.argv[TIME_BUDGET_ARG + 1], 10) || 0
  : 0;   // 0 = no budget (run until done or hard-killed)
const START_TIME = Date.now();

function timeExpired() {
  if (!TIME_BUDGET_MIN) return false;
  const elapsedMin = (Date.now() - START_TIME) / 60000;
  return elapsedMin >= TIME_BUDGET_MIN;
}

function timeRemaining() {
  if (!TIME_BUDGET_MIN) return Infinity;
  return TIME_BUDGET_MIN - (Date.now() - START_TIME) / 60000;
}

// ─────────────────────────── Configuration ───────────────────────────

const BATCH_SIZE     = 20;    // Supabase upsert batch
const GEMINI_MODEL   = 'gemini-2.5-flash';
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const MAX_ENRICH_ATTEMPTS = 3;  // after this many failures, mark as 'skipped'
const ENRICH_CONCURRENCY = 5;   // parallel Gemini calls

// Incremental: cap per run to stay within GitHub Actions timeout
const INCREMENTAL_CAP = 300;

// GitHub Search API returns max 1000 results per query.
// We use star-range buckets to get past this limit.
const STAR_BUCKETS = [
  'stars:>1000', 'stars:501..1000', 'stars:201..500', 'stars:101..200',
  'stars:51..100', 'stars:21..50', 'stars:11..20', 'stars:6..10',
  'stars:3..5', 'stars:1..2', 'stars:0',
];

// ─────────────────────────── Search Queries ──────────────────────────

const SEARCH_QUERIES = [
  // ── MCP Servers (~8,600+)
  { hint: 'mcp-server', q: '"mcp-server" in:name language:TypeScript', sort: 'stars', pages: 34, bucketed: true },
  { hint: 'mcp-server', q: '"mcp-server" in:name language:Python',     sort: 'stars', pages: 34, bucketed: true },
  { hint: 'mcp-server', q: '"mcp-server" in:name language:Go',         sort: 'stars', pages: 10, bucketed: false },
  { hint: 'mcp-server', q: '"mcp-server" in:name language:Rust',       sort: 'stars', pages: 10, bucketed: false },
  { hint: 'mcp-server', q: '"mcp-server" in:name language:Java',       sort: 'stars', pages: 10, bucketed: false },
  { hint: 'mcp-server', q: '"mcp-server" in:name language:C#',         sort: 'stars', pages: 10, bucketed: false },
  { hint: 'mcp-server', q: 'topic:mcp-server',                         sort: 'stars', pages: 34, bucketed: true },
  { hint: 'mcp-server', q: 'topic:model-context-protocol',             sort: 'stars', pages: 20, bucketed: false },
  { hint: 'mcp-server', q: '"mcp" "server" in:name,description filename:mcp.json', sort: 'stars', pages: 10, bucketed: false },
  { hint: 'mcp-server', q: '"@modelcontextprotocol/sdk" in:readme',    sort: 'stars', pages: 10, bucketed: false },

  // ── Cursor Rules (~800+)
  { hint: 'cursor-rules', q: 'topic:cursor-rules',                            sort: 'stars', pages: 34, bucketed: false },
  { hint: 'cursor-rules', q: 'topic:cursorrules',                             sort: 'stars', pages: 34, bucketed: false },
  { hint: 'cursor-rules', q: '"cursorrules" in:name,description',             sort: 'stars', pages: 20, bucketed: false },
  { hint: 'cursor-rules', q: '"cursor rules" in:name,description',            sort: 'stars', pages: 10, bucketed: false },
  { hint: 'cursor-rules', q: '"cursor-rules" in:name',                        sort: 'stars', pages: 10, bucketed: false },
  { hint: 'cursor-rules', q: 'topic:cursor-skills',                           sort: 'stars', pages: 5,  bucketed: false },
  { hint: 'cursor-rules', q: 'filename:.cursorrules path:/',                  sort: 'stars', pages: 20, bucketed: false },

  // ── Skills / Claude Code (~15,000+)
  { hint: 'skill', q: 'topic:agent-skills',                                   sort: 'stars', pages: 34, bucketed: true },
  { hint: 'skill', q: 'topic:agent-skill',                                    sort: 'stars', pages: 20, bucketed: false },
  { hint: 'skill', q: 'topic:claude-skills',                                  sort: 'stars', pages: 20, bucketed: false },
  { hint: 'skill', q: 'topic:claude-code',                                    sort: 'stars', pages: 34, bucketed: true },
  { hint: 'skill', q: '"agent-skills" in:name',                               sort: 'stars', pages: 34, bucketed: true },
  { hint: 'skill', q: 'filename:SKILL.md',                                    sort: 'stars', pages: 34, bucketed: true },
  { hint: 'skill', q: '"npx skills add" in:readme',                           sort: 'stars', pages: 20, bucketed: false },
  { hint: 'skill', q: '"claude-code-skill" in:name,description,topics',       sort: 'stars', pages: 10, bucketed: false },
  { hint: 'skill', q: 'topic:oneskill',                                       sort: 'stars', pages: 10, bucketed: false },
  { hint: 'skill', q: '"skillkit" in:name,description',                       sort: 'stars', pages: 10, bucketed: false },
  { hint: 'skill', q: '"claude-code" "plugin" in:name,description',           sort: 'stars', pages: 10, bucketed: false },
  { hint: 'skill', q: '"agent-skills-cli" OR "openskills" in:readme',         sort: 'stars', pages: 5,  bucketed: false },

  // ── n8n Nodes (~5,800+)
  { hint: 'n8n-node', q: '"n8n-nodes-" in:name',                              sort: 'stars', pages: 34, bucketed: true },
  { hint: 'n8n-node', q: 'topic:n8n-community-node-package',                  sort: 'stars', pages: 34, bucketed: true },
  { hint: 'n8n-node', q: 'topic:n8n-community-node',                          sort: 'stars', pages: 34, bucketed: false },
  { hint: 'n8n-node', q: 'topic:n8n-community-nodes',                         sort: 'stars', pages: 34, bucketed: false },
  { hint: 'n8n-node', q: 'topic:n8n-node',                                    sort: 'stars', pages: 20, bucketed: false },
  { hint: 'n8n-node', q: '"n8n community node" in:description',               sort: 'stars', pages: 10, bucketed: false },
  { hint: 'n8n-node', q: '"n8n-community-node-package" in:readme',            sort: 'stars', pages: 20, bucketed: false },
  { hint: 'n8n-node', q: '"n8n-nodes" in:name language:TypeScript',           sort: 'stars', pages: 20, bucketed: false },

  // ── Workflows (~thousands)
  { hint: 'workflow', q: 'topic:ai-workflow',                                  sort: 'stars', pages: 20, bucketed: false },
  { hint: 'workflow', q: 'topic:agent-workflow',                               sort: 'stars', pages: 20, bucketed: false },
  { hint: 'workflow', q: 'topic:agentic-workflow',                             sort: 'stars', pages: 20, bucketed: false },
  { hint: 'workflow', q: 'topic:langgraph',                                    sort: 'stars', pages: 34, bucketed: false },
  { hint: 'workflow', q: 'topic:agent-orchestration',                          sort: 'stars', pages: 10, bucketed: false },
  { hint: 'workflow', q: '"agent workflow" in:name,description',               sort: 'stars', pages: 10, bucketed: false },
  { hint: 'workflow', q: '"ai workflow" in:name,description',                  sort: 'stars', pages: 10, bucketed: false },
  { hint: 'workflow', q: 'topic:autogen',                                      sort: 'stars', pages: 10, bucketed: false },

  // ── LangChain Tools (~1,000+)
  { hint: 'langchain-tool', q: 'topic:langchain-tool',                        sort: 'stars', pages: 20, bucketed: false },
  { hint: 'langchain-tool', q: 'topic:langchain-tools',                       sort: 'stars', pages: 20, bucketed: false },
  { hint: 'langchain-tool', q: '"langchain" "tool" in:name,description',      sort: 'stars', pages: 34, bucketed: true },
  { hint: 'langchain-tool', q: '"langchain-community" in:name',               sort: 'stars', pages: 10, bucketed: false },
  { hint: 'langchain-tool', q: 'topic:langchain language:python',             sort: 'stars', pages: 20, bucketed: false },
  { hint: 'langchain-tool', q: '"langchain" "integration" in:name,description', sort: 'stars', pages: 10, bucketed: false },

  // ── CrewAI Tools (~500+)
  { hint: 'crewai-tool', q: 'topic:crewai',                                   sort: 'stars', pages: 34, bucketed: true },
  { hint: 'crewai-tool', q: 'topic:crewai-tools',                             sort: 'stars', pages: 20, bucketed: false },
  { hint: 'crewai-tool', q: '"crewai" "tool" in:name,description',            sort: 'stars', pages: 20, bucketed: false },
  { hint: 'crewai-tool', q: '"crewai_tools" in:readme',                       sort: 'stars', pages: 10, bucketed: false },
  { hint: 'crewai-tool', q: '"crewai" in:name language:python',               sort: 'stars', pages: 20, bucketed: false },
];

// ─────────────────────────── Helpers ─────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function log(emoji, msg) { console.log(`${emoji}  ${msg}`); }

// ─────────────────────────── Environment ─────────────────────────────

const ENV = {
  SUPABASE_URL:              process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  GITHUB_PAT:                process.env.GITHUB_PAT || process.env.GITHUB_TOKEN,
  GEMINI_API_KEY:            process.env.GEMINI_API_KEY,
};

function validateEnv() {
  const mode = FLAGS.discover ? 'discover' : FLAGS.enrich ? 'enrich' : FLAGS.bulk ? 'bulk' : 'incremental';
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  // Gemini only needed for enrich/bulk/incremental
  if (!FLAGS.discover) required.push('GEMINI_API_KEY');
  const missing = required.filter((k) => !ENV[k]);
  if (missing.length) { console.error(`Missing env vars: ${missing.join(', ')}`); process.exit(1); }
  if (!ENV.GITHUB_PAT) log('⚠️', 'No GITHUB_PAT — search rate limit will be 10 req/min');
  log('✅', `Environment OK — mode: ${mode}`);
}

// ─────────────────────────── Supabase helpers ────────────────────────

const sbHeaders = () => ({
  'Content-Type':  'application/json',
  Authorization:   `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`,
  apikey:          ENV.SUPABASE_SERVICE_ROLE_KEY,
});

async function sbGet(table, query = '') {
  const res = await fetch(`${ENV.SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Supabase GET ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbUpsert(table, rows, onConflict) {
  const headers = { ...sbHeaders(), Prefer: 'resolution=merge-duplicates,return=representation' };
  const res = await fetch(
    `${ENV.SUPABASE_URL}/rest/v1/${table}${onConflict ? `?on_conflict=${onConflict}` : ''}`,
    { method: 'POST', headers, body: JSON.stringify(rows) },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase UPSERT ${table}: ${res.status} ${text.substring(0, 300)}`);
  }
  return res.json();
}

async function sbPatch(table, query, patch) {
  const headers = { ...sbHeaders(), Prefer: 'return=representation' };
  const res = await fetch(
    `${ENV.SUPABASE_URL}/rest/v1/${table}?${query}`,
    { method: 'PATCH', headers, body: JSON.stringify(patch) },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase PATCH ${table}: ${res.status} ${text.substring(0, 300)}`);
  }
  return res.json();
}

// ─────────────────────────── Lookup maps ─────────────────────────────

let TYPE_MAP     = {};   // slug → uuid
let CATEGORY_MAP = {};   // slug → uuid
let PLATFORM_MAP = {};   // label → { id, slug }

async function loadLookups() {
  const [types, cats, plats] = await Promise.all([
    sbGet('artifact_types', 'select=id,slug'),
    sbGet('categories', 'select=id,slug,label'),
    sbGet('platforms', 'select=id,slug,label'),
  ]);

  for (const t of types)  TYPE_MAP[t.slug] = t.id;
  for (const c of cats)   CATEGORY_MAP[c.slug] = c.id;
  for (const p of plats)  PLATFORM_MAP[p.label] = { id: p.id, slug: p.slug };

  log('📋', `Loaded ${types.length} types, ${cats.length} categories, ${plats.length} platforms`);
}

// Map Gemini's category labels to DB slugs
const CATEGORY_LABEL_TO_SLUG = {
  'Frontend': 'frontend', 'Backend': 'backend', 'DevOps': 'devops',
  'AI / ML': 'ai-ml', 'Database': 'database', 'Security': 'security',
  'Automation': 'automation', 'Web Scraping': 'web-scraping', 'Research': 'research',
  'Design': 'design', 'Mobile': 'mobile', 'Testing': 'testing',
  'Data Engineering': 'data-engineering', 'Documentation': 'documentation',
  'Productivity': 'productivity',
};

// Default platform labels per artifact type slug
const PLATFORM_DEFAULTS = {
  'skill':          ['Claude Code', 'Cursor', 'Windsurf', 'Cline', 'Roo Code', 'OpenCode', 'Kiro CLI', 'GitHub Copilot'],
  'mcp-server':     ['Claude Code', 'Cursor', 'Cline', 'Windsurf', 'Roo Code', 'OpenCode', 'Kiro CLI', 'Continue'],
  'cursor-rules':   ['Cursor'],
  'n8n-node':       ['n8n'],
  'workflow':       ['n8n', 'LangChain', 'CrewAI'],
  'langchain-tool': ['LangChain'],
  'crewai-tool':    ['CrewAI'],
};

// ─────────────────────────── GitHub API ──────────────────────────────

const GITHUB_MAX_RETRIES = 4;  // retries on rate limit (wait + retry, not give up)

async function githubFetch(url, raw = false, retries = GITHUB_MAX_RETRIES) {
  const headers = {
    Accept: raw ? 'application/vnd.github.v3.raw' : 'application/vnd.github.v3+json',
    'User-Agent': 'OneSkill-Scraper/4.0',
  };
  if (ENV.GITHUB_PAT) headers.Authorization = `token ${ENV.GITHUB_PAT}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    const res = await fetch(url, { headers });

    // Proactive: sleep before we actually run out of requests
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining !== null && parseInt(remaining, 10) < 3) {
      const reset = parseInt(res.headers.get('x-ratelimit-reset') || '0', 10) * 1000;
      const wait  = Math.max(0, reset - Date.now()) + 2000;
      log('⏳', `Rate limit low (${remaining} left) — sleeping ${(wait / 1000).toFixed(0)}s`);
      await sleep(wait);
    }

    if (res.status === 403 || res.status === 429) {
      const reset = parseInt(res.headers.get('x-ratelimit-reset') || '0', 10) * 1000;
      const wait  = Math.max(5000, reset - Date.now()) + 2000;
      const cappedWait = Math.min(wait, 120000);  // max 2 min wait
      if (attempt < retries) {
        log('⏳', `Rate limited (${res.status}) — retry ${attempt + 1}/${retries} in ${(cappedWait / 1000).toFixed(0)}s`);
        await sleep(cappedWait);
        continue;  // RETRY instead of returning null
      }
      log('🛑', `Rate limited (${res.status}) — exhausted ${retries} retries, skipping`);
      return null;
    }

    if (res.status === 404 || res.status === 422) return null;  // not found / bad query — don't retry
    if (!res.ok) {
      if (res.status >= 500 && attempt < retries) {
        log('⚠️', `GitHub ${res.status} — retry ${attempt + 1}/${retries}`);
        await sleep(3000 * (attempt + 1));
        continue;
      }
      return null;
    }
    return raw ? res.text() : res.json();
  }
  return null;
}

async function searchRepos(query, sort = 'stars', pages = 1) {
  const repos = [];
  let consecutiveEmpty = 0;

  for (let page = 1; page <= pages; page++) {
    const url =
      `https://api.github.com/search/repositories` +
      `?q=${encodeURIComponent(query)}&sort=${sort}&order=desc&per_page=30&page=${page}`;

    const data = await githubFetch(url);
    if (!data || !data.items) {
      consecutiveEmpty++;
      if (consecutiveEmpty >= 2) {
        log('⚠️', `  [page ${page}] 2 consecutive empty responses — moving on`);
        break;
      }
      log('⚠️', `  [page ${page}] empty response — trying next page`);
      await sleep(3000);
      continue;  // try next page instead of giving up
    }
    consecutiveEmpty = 0;
    repos.push(...data.items);
    if (data.items.length < 30) break;
    if (page >= 34) break;
    await sleep(2200);
  }
  return repos;
}

async function fetchReadme(owner, repo) {
  const url = `https://api.github.com/repos/${owner}/${repo}/readme`;
  const text = await githubFetch(url, true);
  return typeof text === 'string' ? text : null;
}


// ═══════════════════════════════════════════════════════════════════════
// PHASE 1: DISCOVER — GitHub Search → raw_repos (no Gemini)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Convert a GitHub API repo object to a raw_repos row.
 */
function repoToRawRow(repo, hint, readme) {
  return {
    github_full_name:  repo.full_name,
    owner_login:       repo.owner.login,
    repo_name:         repo.name,
    description:       (repo.description || '').substring(0, 500),
    language:          repo.language || null,
    stars:             repo.stargazers_count || 0,
    forks:             repo.forks_count || 0,
    open_issues:       repo.open_issues_count || 0,
    license:           repo.license?.spdx_id || repo.license?.name || null,
    default_branch:    repo.default_branch || 'main',
    topics:            JSON.stringify(repo.topics || []),
    github_url:        repo.html_url,
    owner_avatar_url:  repo.owner.avatar_url,
    owner_html_url:    repo.owner.html_url,
    github_created_at: repo.created_at,
    github_updated_at: repo.updated_at,
    readme_raw:        readme ? readme.substring(0, 50000) : null,
    type_hint:         hint,
    updated_at:        new Date().toISOString(),
  };
}

/**
 * Discover repos via GitHub search and save to raw_repos staging table.
 * No Gemini involved — purely GitHub → Supabase.
 */
async function runDiscover(queries, cap = 0) {
  const budgetStr = TIME_BUDGET_MIN ? `, budget: ${TIME_BUDGET_MIN}min` : '';
  log('🔎', `\n═══ PHASE 1: DISCOVER (${queries.length} queries${cap ? `, cap: ${cap}` : ', no cap'}${budgetStr}) ═══\n`);

  const seen = new Set();
  const repoBuffer = [];    // { repo, hint } — repos waiting for README fetch
  let totalSaved = 0;
  let stoppedByBudget = false;

  for (let qi = 0; qi < queries.length; qi++) {
    const queryDef = queries[qi];
    if (cap && seen.size >= cap) {
      log('📦', `Hit ${cap} cap — stopping search`);
      break;
    }
    if (timeExpired()) {
      log('⏰', `Time budget exhausted (${TIME_BUDGET_MIN}min) — stopping search, will flush remaining buffer`);
      stoppedByBudget = true;
      break;
    }

    const { hint, q, sort, pages, bucketed } = queryDef;
    const buckets = bucketed ? STAR_BUCKETS : [''];

    log('📋', `\n── Query ${qi + 1}/${queries.length} [${hint}] (${bucketed ? buckets.length + ' buckets' : 'no buckets'}, ${pages}p) [${timeRemaining().toFixed(1)}min left] ──`);

    for (const bucket of buckets) {
      if (cap && seen.size >= cap) break;
      if (timeExpired()) { stoppedByBudget = true; break; }

      const fullQuery = bucket ? `${q} ${bucket}` : q;
      const maxPages = Math.min(pages, 34);

      log('🔎', `[${hint}] ${fullQuery} (${maxPages}p)`);
      const repos = await searchRepos(fullQuery, sort, maxPages);

      let added = 0;
      for (const repo of repos) {
        if (cap && seen.size >= cap) break;
        const key = repo.full_name;
        if (!seen.has(key)) {
          seen.add(key);
          repoBuffer.push({ repo, hint });
          added++;
        }
      }
      log('  ', `→ ${repos.length} results, ${added} new (${seen.size} total unique, ${repoBuffer.length} buffered)`);
      await sleep(2500);

      if (repos.length < 30) continue;
    }
    if (stoppedByBudget) break;

    // Flush buffer in chunks of 100 (save to raw_repos WITHOUT README — much faster)
    while (repoBuffer.length >= 100) {
      const batch = repoBuffer.splice(0, 100);
      totalSaved += await saveReposBatch(batch);
      log('💾', `Saved batch — ${totalSaved} total saved, ${seen.size} unique discovered`);
    }
  }

  // Flush remaining
  if (repoBuffer.length > 0) {
    totalSaved += await saveReposBatch(repoBuffer.splice(0));
  }

  log('📊', `Discovery complete: ${seen.size} unique repos found, ${totalSaved} saved to raw_repos`);
  return totalSaved;
}

/**
 * Save repos to raw_repos WITHOUT fetching READMEs.
 * README is fetched lazily during enrich (when Gemini actually needs it).
 * This makes discover ~5x faster — pure search API only.
 */
async function saveReposBatch(batch) {
  const rows = batch.map(({ repo, hint }) => repoToRawRow(repo, hint, null));

  let saved = 0;
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const chunk = rows.slice(start, start + BATCH_SIZE);
    try {
      const result = await sbUpsert('raw_repos', chunk, 'github_full_name');
      saved += result.length;
    } catch (err) {
      log('⚠️', `raw_repos batch save error: ${err.message.substring(0, 120)}`);
      for (const row of chunk) {
        try {
          await sbUpsert('raw_repos', [row], 'github_full_name');
          saved++;
        } catch (e2) {
          log('  ', `Skip ${row.github_full_name}: ${e2.message.substring(0, 80)}`);
        }
      }
    }
  }

  log('💾', `Saved ${saved}/${rows.length} repos to raw_repos`);
  return saved;
}


// ═══════════════════════════════════════════════════════════════════════
// PHASE 2: ENRICH — raw_repos → Gemini → artifacts
// ═══════════════════════════════════════════════════════════════════════

// ─── Gemini ──────────────────────────────────────────────────────────

const GEMINI_CATEGORIES = Object.keys(CATEGORY_LABEL_TO_SLUG);
const GEMINI_PLATFORMS  = [
  'Claude Code', 'Cursor', 'Cline', 'Windsurf', 'Roo Code', 'OpenCode',
  'Kiro CLI', 'Continue', 'GitHub Copilot', 'Aider', 'Codex CLI', 'Amp',
  'Devin', 'Replit Agent', 'Bolt', 'Lovable', 'v0', 'Manus', 'OpenClaw',
  'Antigravity', 'n8n', 'LangChain', 'CrewAI', 'AutoGen', 'Semantic Kernel',
  'Zapier', 'Make', 'Activepieces', 'SuperAgent', 'E2B', 'Composio',
  'Toolhouse', 'Browserbase', 'Steel', 'Firecrawl', 'Apify', 'Julep', 'Letta',
];

const VALID_TYPES = ['skill', 'mcp-server', 'cursor-rules', 'n8n-node', 'workflow', 'langchain-tool', 'crewai-tool'];

// Gemini Structured Output schema — forces valid JSON, no parsing needed
const GEMINI_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    artifact_type:        { type: 'STRING', enum: VALID_TYPES },
    long_description:     { type: 'STRING' },
    category:             { type: 'STRING', enum: GEMINI_CATEGORIES },
    tags:                 { type: 'ARRAY', items: { type: 'STRING' } },
    compatible_platforms: { type: 'ARRAY', items: { type: 'STRING', enum: GEMINI_PLATFORMS } },
    install_command:      { type: 'STRING' },
    npm_package_name:     { type: 'STRING', nullable: true },
    meta_title:           { type: 'STRING' },
    meta_description:     { type: 'STRING' },
  },
  required: ['artifact_type', 'long_description', 'category', 'tags', 'compatible_platforms', 'install_command', 'meta_title', 'meta_description'],
};

function validateEnrichment(p, hint) {
  if (!p || typeof p !== 'object') return null;
  if (!VALID_TYPES.includes(p.artifact_type)) p.artifact_type = hint;
  if (!GEMINI_CATEGORIES.includes(p.category)) p.category = 'AI / ML';
  if (Array.isArray(p.compatible_platforms)) {
    p.compatible_platforms = p.compatible_platforms.filter(pl => GEMINI_PLATFORMS.includes(pl));
  }
  if (Array.isArray(p.tags)) p.tags = p.tags.slice(0, 7);
  return p;
}

function buildSingleRepoPrompt(item) {
  const excerpt = item.readme ? item.readme.substring(0, 2500) : 'No README.';
  return `Classify this GitHub repository as an "agent artifact" for OneSkill.dev.

Repository: ${item.full_name}
Description: ${item.description || '(none)'}
Language: ${item.language || 'Unknown'}
Stars: ${item.stars} | Forks: ${item.forks}
Topics: ${item.topics_str || '(none)'}
Updated: ${item.github_updated_at}

README:
${excerpt}

Rules:
- artifact_type: MCP server → "mcp-server" | Cursor rules → "cursor-rules" | Skill/SKILL.md → "skill" | n8n node → "n8n-node" | Workflow → "workflow" | LangChain tool → "langchain-tool" | CrewAI tool → "crewai-tool"
- long_description: 2-3 sentence summary of what this tool does
- tags: 3-7 lowercase hyphenated keywords
- install_command: npm → "npx -y <pkg>" | skills → "npx skills add owner/repo" | pip → "pip install <pkg>" | n8n → "npm install <pkg>"
- meta_title: under 60 chars
- meta_description: under 160 chars`;
}

/**
 * Enrich a single raw_repo row via Gemini with structured output.
 * Uses responseSchema so Gemini MUST return valid JSON — no parsing needed.
 */
async function enrichOneWithGemini(item, retries = 3) {
  const prompt = buildSingleRepoPrompt(item);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${GEMINI_URL}?key=${ENV.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 4096,
            responseMimeType: 'application/json',
            responseSchema: GEMINI_RESPONSE_SCHEMA,
            // Disable "thinking" — it eats output tokens and causes MAX_TOKENS truncation
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      });

      if (res.status === 429) {
        const wait = Math.pow(2, attempt + 1) * 5000;
        log('⏳', `Gemini 429 for ${item.full_name} — retry in ${(wait / 1000).toFixed(0)}s`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        const errText = await res.text();
        log('  ', `Gemini ${res.status} for ${item.full_name}: ${errText.substring(0, 200)}`);
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      const finishReason = data.candidates?.[0]?.finishReason;
      if (finishReason && finishReason !== 'STOP') {
        log('  ', `Gemini finish=${finishReason} for ${item.full_name}`);
        if (finishReason === 'SAFETY' || finishReason === 'RECITATION') {
          return null;  // can't process this repo
        }
      }

      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!raw) throw new Error('Empty response');

      // With responseSchema, Gemini returns valid JSON — just parse it
      const parsed = JSON.parse(raw);
      return validateEnrichment(parsed, item.type_hint);
    } catch (err) {
      if (attempt < retries) {
        log('  ', `  retry ${attempt + 1}/${retries} for ${item.full_name}: ${err.message.substring(0, 80)}`);
        await sleep(2000 * (attempt + 1));
      } else {
        log('❌', `  FAILED ${item.full_name} after ${retries + 1} attempts: ${err.message.substring(0, 80)}`);
        return null;
      }
    }
  }
  return null;
}

/**
 * Enrich items with concurrency control.
 * Processes ENRICH_CONCURRENCY repos in parallel for speed.
 */
async function enrichBatchConcurrent(items) {
  const results = new Array(items.length).fill(null);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await enrichOneWithGemini(items[idx]);
      if (results[idx]) {
        log('  ', `✅ ${items[idx].full_name}`);
      }
    }
  }

  const workers = Array.from({ length: Math.min(ENRICH_CONCURRENCY, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ─── Contributors ────────────────────────────────────────────────────

const contributorCache = new Map();

async function ensureContributor(rawRepo) {
  const username = rawRepo.owner_login;
  if (contributorCache.has(username)) return contributorCache.get(username);

  const row = {
    github_username: username,
    display_name:    username,
    avatar_url:      rawRepo.owner_avatar_url,
    github_url:      rawRepo.owner_html_url,
  };

  try {
    const result = await sbUpsert('contributors', [row], 'github_username');
    const id = result?.[0]?.id;
    if (id) { contributorCache.set(username, id); return id; }
  } catch (err) {
    log('  ', `Contributor issue for ${username}: ${err.message.substring(0, 80)}`);
  }

  try {
    const existing = await sbGet('contributors', `github_username=eq.${encodeURIComponent(username)}&select=id&limit=1`);
    if (existing?.[0]?.id) { contributorCache.set(username, existing[0].id); return existing[0].id; }
  } catch { /* ignore */ }

  return null;
}

// ─── Build artifact from raw_repo + enrichment ──────────────────────

function buildArtifact(rawRepo, enrichment, contributorId) {
  const e = enrichment || {};
  const typeSlug = e.artifact_type || rawRepo.type_hint;
  const catLabel = e.category || 'AI / ML';
  const catSlug  = CATEGORY_LABEL_TO_SLUG[catLabel] || 'ai-ml';

  const stars = rawRepo.stars || 0;
  const forks = rawRepo.forks || 0;
  const daysAgo = (Date.now() - new Date(rawRepo.github_updated_at).getTime()) / 86400000;
  const starScore    = Math.min(40, Math.floor(Math.log10(Math.max(1, stars)) * 15));
  const forkScore    = Math.min(15, Math.floor(Math.log10(Math.max(1, forks)) * 8));
  const recencyScore = daysAgo < 14 ? 20 : daysAgo < 30 ? 15 : daysAgo < 90 ? 8 : 0;
  const trendingScore = Math.min(100, starScore + forkScore + recencyScore);

  const slug = rawRepo.github_full_name.replace('/', '-').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const artifactTypeId = TYPE_MAP[typeSlug];
  const categoryId     = CATEGORY_MAP[catSlug];

  if (!artifactTypeId) {
    log('⚠️', `Unknown type "${typeSlug}" for ${rawRepo.github_full_name} — skipping`);
    return null;
  }

  return {
    slug, name: rawRepo.repo_name,
    description:            (rawRepo.description || '').substring(0, 500),
    long_description:       (e.long_description || rawRepo.description || '').substring(0, 2000),
    artifact_type_id:       artifactTypeId,
    category_id:            categoryId || CATEGORY_MAP['ai-ml'],
    contributor_id:         contributorId,
    github_url:             rawRepo.github_url,
    github_repo_full_name:  rawRepo.github_full_name,
    default_branch:         rawRepo.default_branch || 'main',
    language:               rawRepo.language || null,
    license:                rawRepo.license || null,
    install_command:        e.install_command || `npx skills add ${rawRepo.github_full_name}`,
    npm_package_name:       e.npm_package_name || null,
    stars, forks,
    open_issues:            rawRepo.open_issues || 0,
    weekly_downloads:       0,
    trending_score:         trendingScore,
    version:                null,
    latest_commit_sha:      null,
    readme_raw:             rawRepo.readme_raw ? rawRepo.readme_raw.substring(0, 50000) : null,
    readme_excerpt:         rawRepo.readme_raw ? rawRepo.readme_raw.substring(0, 500) : null,
    tags:                   Array.isArray(e.tags) ? e.tags.slice(0, 7) : [],
    meta_title:             e.meta_title || `${rawRepo.repo_name} — OneSkill`,
    meta_description:       e.meta_description || (rawRepo.description || '').substring(0, 160),
    status:                 'active',
    source:                 'github_scraper',
    is_featured:            false,
    github_created_at:      rawRepo.github_created_at,
    github_updated_at:      rawRepo.github_updated_at,
    last_pipeline_sync:     new Date().toISOString(),
    _platform_labels:       Array.isArray(e.compatible_platforms) && e.compatible_platforms.length
                              ? e.compatible_platforms : (PLATFORM_DEFAULTS[typeSlug] || []),
    _type_slug:             typeSlug,
  };
}

// ─── Upsert artifacts ────────────────────────────────────────────────

async function upsertArtifacts(artifacts) {
  let upserted = 0;
  for (let start = 0; start < artifacts.length; start += BATCH_SIZE) {
    const batch = artifacts.slice(start, start + BATCH_SIZE);
    const rows = batch.map(a => {
      const { _platform_labels, _type_slug, _raw_repo_full_name, ...row } = a;
      return row;
    });

    try {
      const result = await sbUpsert('artifacts', rows, 'github_repo_full_name');
      upserted += result.length;

      for (let i = 0; i < result.length; i++) {
        const artifactId = result[i].id;
        const labels = batch[i]._platform_labels || [];
        const junctionRows = labels
          .map(l => PLATFORM_MAP[l]).filter(Boolean)
          .map(p => ({ artifact_id: artifactId, platform_id: p.id }));

        if (junctionRows.length > 0) {
          try { await sbUpsert('artifact_platforms', junctionRows, 'artifact_id,platform_id'); }
          catch (err) { log('  ', `Junction issue: ${err.message.substring(0, 80)}`); }
        }

        // Update raw_repos with the artifact_id link
        try {
          await sbPatch(
            'raw_repos',
            `github_full_name=eq.${encodeURIComponent(batch[i].github_repo_full_name)}`,
            { artifact_id: artifactId, enrichment_status: 'enriched', enriched_at: new Date().toISOString() }
          );
        } catch { /* non-critical */ }
      }
      log('💾', `Batch upserted: ${result.length} (${upserted} total)`);
    } catch (err) {
      log('❌', `Batch failed: ${err.message.substring(0, 150)}`);
      // Fallback: one by one
      for (let j = 0; j < rows.length; j++) {
        try {
          const result = await sbUpsert('artifacts', [rows[j]], 'github_repo_full_name');
          upserted++;
          const artifactId = result?.[0]?.id;
          if (artifactId) {
            const labels = batch[j]._platform_labels || [];
            const junctionRows = labels.map(l => PLATFORM_MAP[l]).filter(Boolean)
              .map(p => ({ artifact_id: artifactId, platform_id: p.id }));
            if (junctionRows.length) {
              try { await sbUpsert('artifact_platforms', junctionRows, 'artifact_id,platform_id'); }
              catch { /* ignore */ }
            }
            try {
              await sbPatch(
                'raw_repos',
                `github_full_name=eq.${encodeURIComponent(batch[j].github_repo_full_name)}`,
                { artifact_id: artifactId, enrichment_status: 'enriched', enriched_at: new Date().toISOString() }
              );
            } catch { /* non-critical */ }
          }
        } catch (e2) { log('  ', `Skip: ${e2.message.substring(0, 80)}`); }
      }
    }
  }
  return upserted;
}

/**
 * PHASE 2: Fetch unenriched rows from raw_repos, run Gemini, upsert to artifacts.
 * Each row is marked as enriched/failed individually — fully retryable.
 */
async function runEnrich(limit = ENRICH_LIMIT) {
  log('🤖', `\n═══ PHASE 2: ENRICH (limit: ${limit}) ═══\n`);

  // Fetch pending/failed rows PER TYPE so every artifact type gets a fair share.
  // Without this, the top-N by stars would all be MCP servers (most popular type).
  const ENRICH_SELECT = `id,github_full_name,owner_login,repo_name,description,language,stars,forks,open_issues,license,default_branch,topics,github_url,owner_avatar_url,owner_html_url,github_created_at,github_updated_at,readme_raw,type_hint,enrich_attempts`;
  const typeHints = [...new Set(SEARCH_QUERIES.map(q => q.hint))];
  const perTypeLimit = Math.max(20, Math.ceil(limit / typeHints.length));

  log('📋', `Fetching up to ${perTypeLimit} per type across ${typeHints.length} types`);

  let pending = [];
  for (const hint of typeHints) {
    const rows = await sbGet(
      'raw_repos',
      `enrichment_status=in.(pending,failed)` +
      `&type_hint=eq.${encodeURIComponent(hint)}` +
      `&enrich_attempts=lt.${MAX_ENRICH_ATTEMPTS}` +
      `&order=stars.desc` +
      `&limit=${perTypeLimit}` +
      `&select=${ENRICH_SELECT}`
    );
    log('  ', `${hint}: ${rows.length} pending`);
    pending.push(...rows);
  }

  // Sort combined list by stars DESC for processing priority
  pending.sort((a, b) => (b.stars || 0) - (a.stars || 0));

  if (pending.length === 0) {
    log('✅', 'No unenriched repos to process');
    return 0;
  }

  log('📦', `Found ${pending.length} repos to enrich (${perTypeLimit} per type, ${typeHints.length} types)`);

  let totalUpserted = 0;
  let enriched = 0;
  let failed = 0;

  // Process in Gemini-batch-sized chunks
  // Process in waves of 20 repos at a time (ENRICH_CONCURRENCY parallel Gemini calls)
  const WAVE_SIZE = 20;
  for (let start = 0; start < pending.length; start += WAVE_SIZE) {
    const wave = pending.slice(start, start + WAVE_SIZE);

    // Lazy-fetch READMEs for repos that don't have one yet
    // (discover phase now skips README for speed — we fetch here instead)
    let readmeFetched = 0;
    for (const row of wave) {
      if (!row.readme_raw) {
        const readme = await fetchReadme(row.owner_login, row.repo_name);
        if (readme) {
          row.readme_raw = readme;
          // Persist README to raw_repos so we don't re-fetch next time
          try {
            await sbPatch('raw_repos', `id=eq.${row.id}`, {
              readme_raw: readme.substring(0, 50000),
              updated_at: new Date().toISOString(),
            });
          } catch { /* non-critical */ }
          readmeFetched++;
        }
        await sleep(350);
      }
    }
    if (readmeFetched > 0) log('📖', `Fetched ${readmeFetched} missing READMEs for this wave`);

    // Prepare items for Gemini prompt
    const geminiItems = wave.map(row => ({
      full_name:        row.github_full_name,
      description:      row.description,
      language:         row.language,
      stars:            row.stars,
      forks:            row.forks,
      topics_str:       Array.isArray(row.topics) ? row.topics.join(', ') : (row.topics || ''),
      github_updated_at: row.github_updated_at,
      readme:           row.readme_raw,
      type_hint:        row.type_hint,
    }));

    log('🤖', `Wave ${Math.floor(start / WAVE_SIZE) + 1}/${Math.ceil(pending.length / WAVE_SIZE)} — ${wave.length} repos (${ENRICH_CONCURRENCY} parallel)`);

    const enrichments = await enrichBatchConcurrent(geminiItems);
    await sleep(500);

    const artifacts = [];
    for (let j = 0; j < wave.length; j++) {
      const rawRepo = wave[j];
      const enrichment = enrichments[j];

      if (!enrichment) {
        // Mark as failed, increment attempt counter
        failed++;
        const newAttempts = (rawRepo.enrich_attempts || 0) + 1;
        const newStatus = newAttempts >= MAX_ENRICH_ATTEMPTS ? 'skipped' : 'failed';
        try {
          await sbPatch(
            'raw_repos',
            `id=eq.${rawRepo.id}`,
            {
              enrichment_status: newStatus,
              enrichment_error: 'Gemini enrichment returned null',
              enrich_attempts: newAttempts,
              updated_at: new Date().toISOString(),
            }
          );
        } catch { /* non-critical */ }
        if (newStatus === 'skipped') {
          log('  ', `⏭️  Skipping ${rawRepo.github_full_name} after ${newAttempts} failed attempts`);
        }
        continue;
      }

      // Increment attempt counter even on success
      try {
        await sbPatch(
          'raw_repos',
          `id=eq.${rawRepo.id}`,
          { enrich_attempts: (rawRepo.enrich_attempts || 0) + 1, updated_at: new Date().toISOString() }
        );
      } catch { /* non-critical */ }

      const contributorId = await ensureContributor(rawRepo);
      const artifact = buildArtifact(rawRepo, enrichment, contributorId);
      if (artifact) {
        artifact._raw_repo_full_name = rawRepo.github_full_name;
        artifacts.push(artifact);
        enriched++;
      }
    }

    if (artifacts.length > 0) {
      totalUpserted += await upsertArtifacts(artifacts);
    }

    const pct = Math.round(((start + wave.length) / pending.length) * 100);
    log('📊', `Progress: ${enriched} enriched, ${failed} failed (${pct}%)`);
  }

  log('🏁', `Enrich complete: ${enriched} enriched, ${failed} failed, ${totalUpserted} upserted to artifacts`);
  return totalUpserted;
}


// ═══════════════════════════════════════════════════════════════════════
// MODE RUNNERS
// ═══════════════════════════════════════════════════════════════════════

async function runIncremental() {
  log('🔄', `\n═══ INCREMENTAL MODE — discover recent + enrich pending ═══\n`);

  // Phase 1: Discover recently updated repos
  const since = new Date(Date.now() - 4 * 3600 * 1000).toISOString().split('T')[0];
  let baseQueries = SEARCH_QUERIES;
  if (TYPE_FILTER) {
    baseQueries = baseQueries.filter(sq => sq.hint === TYPE_FILTER);
    log('🏷️', `Incremental filtered to ${baseQueries.length} queries for type: ${TYPE_FILTER}`);
  }

  const incrementalQueries = baseQueries.map(sq => ({
    ...sq,
    pages: Math.min(sq.pages, 3),   // tighter page cap for daily runs
    bucketed: false,
    sort: 'updated',
    q: `${sq.q} pushed:>=${since}`,
  }));

  await runDiscover(incrementalQueries, INCREMENTAL_CAP);

  // Phase 2: Enrich anything pending (including new + previously failed)
  await runEnrich(ENRICH_LIMIT);
}

async function runBulk() {
  log('📦', `\n═══ BULK MODE — full discover + enrich ═══\n`);

  // Phase 1: Full discovery (all queries, all buckets)
  await runDiscover(SEARCH_QUERIES, 0);

  // Phase 2: Enrich everything pending (large limit)
  await runEnrich(10000);
}

// ─────────────────────────── Entry point ────────────────────────────

async function main() {
  const startTime = Date.now();
  validateEnv();
  await loadLookups();

  if (FLAGS.discover) {
    // Discover only — optionally filtered by --type and capped by --discover-limit
    let queries = SEARCH_QUERIES;
    if (TYPE_FILTER) {
      queries = queries.filter(sq => sq.hint === TYPE_FILTER);
      log('🏷️', `Filtered to ${queries.length} queries for type: ${TYPE_FILTER}`);
      if (queries.length === 0) {
        log('⚠️', `No queries found for type "${TYPE_FILTER}". Valid types: ${[...new Set(SEARCH_QUERIES.map(q => q.hint))].join(', ')}`);
        return;
      }
    }
    await runDiscover(queries, DISCOVER_LIMIT || 0);
  } else if (FLAGS.enrich) {
    // Enrich only — pick up pending/failed rows
    await runEnrich(ENRICH_LIMIT);
  } else if (FLAGS.bulk) {
    await runBulk();
  } else {
    await runIncremental();
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  log('⏱️', `Total time: ${elapsed} min`);
}

main().catch((err) => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
