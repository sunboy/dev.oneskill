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
  ? parseInt(process.argv[ENRICH_LIMIT_ARG + 1], 10) || 200
  : 200;

// ─────────────────────────── Configuration ───────────────────────────

const BATCH_SIZE     = 20;    // Supabase upsert batch
const GEMINI_BATCH   = 5;     // repos per Gemini call (lower = more reliable JSON)
const GEMINI_MODEL   = 'gemini-2.5-flash';
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const MAX_ENRICH_ATTEMPTS = 3;  // after this many failures, mark as 'skipped'

// Incremental: cap per run to stay within GitHub Actions timeout
const INCREMENTAL_CAP = 500;

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

    if (res.status === 422) return null;  // bad query, don't retry
    if (!res.ok) {
      if (attempt < retries) {
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
  log('🔎', `\n═══ PHASE 1: DISCOVER (${queries.length} queries${cap ? `, cap: ${cap}` : ', no cap'}) ═══\n`);

  const seen = new Set();
  const repoBuffer = [];    // { repo, hint } — repos waiting for README fetch
  let totalSaved = 0;

  for (let qi = 0; qi < queries.length; qi++) {
    const queryDef = queries[qi];
    if (cap && seen.size >= cap) {
      log('📦', `Hit ${cap} cap — stopping search`);
      break;
    }

    const { hint, q, sort, pages, bucketed } = queryDef;
    const buckets = bucketed ? STAR_BUCKETS : [''];

    log('📋', `\n── Query ${qi + 1}/${queries.length} [${hint}] (${bucketed ? buckets.length + ' buckets' : 'no buckets'}, ${pages}p) ──`);

    for (const bucket of buckets) {
      if (cap && seen.size >= cap) break;

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

    // Flush buffer in chunks of 50 (fetch READMEs → save to raw_repos)
    while (repoBuffer.length >= 50) {
      const batch = repoBuffer.splice(0, 50);
      totalSaved += await fetchReadmesAndSave(batch);
      log('💾', `Saved batch — ${totalSaved} total saved, ${seen.size} unique discovered`);
    }
  }

  // Flush remaining
  if (repoBuffer.length > 0) {
    totalSaved += await fetchReadmesAndSave(repoBuffer.splice(0));
  }

  log('📊', `Discovery complete: ${seen.size} unique repos found, ${totalSaved} saved to raw_repos`);
  return totalSaved;
}

/**
 * Fetch READMEs for a batch and upsert to raw_repos.
 */
async function fetchReadmesAndSave(batch) {
  log('📖', `Fetching READMEs for ${batch.length} repos`);
  const rows = [];

  for (let i = 0; i < batch.length; i++) {
    const { repo, hint } = batch[i];
    if (i > 0 && i % 25 === 0) log('  ', `READMEs: ${i}/${batch.length}`);
    const readme = await fetchReadme(repo.owner.login, repo.name);
    rows.push(repoToRawRow(repo, hint, readme));
    await sleep(350);
  }

  // Upsert to raw_repos — update metadata on conflict but DON'T overwrite enrichment_status
  // if it's already enriched
  let saved = 0;
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const chunk = rows.slice(start, start + BATCH_SIZE);
    try {
      const result = await sbUpsert('raw_repos', chunk, 'github_full_name');
      saved += result.length;
    } catch (err) {
      log('⚠️', `raw_repos batch save error: ${err.message.substring(0, 120)}`);
      // Fallback: save one by one
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

function repairJSON(raw) {
  let s = raw;
  s = s.replace(/^```(?:json)?\s*/gm, '').replace(/```\s*$/gm, '');
  s = s.replace(/,\s*([\]}])/g, '$1');
  try { return JSON.parse(s); } catch (_) { /* continue */ }

  const m = s.match(/\[[\s\S]*\]/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) { /* continue */ } }

  // Fix unescaped control chars inside JSON strings
  let fixed = '';
  let inString = false;
  let escaped = false;
  const src = m ? m[0] : s;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (escaped) { fixed += ch; escaped = false; continue; }
    if (ch === '\\' && inString) { fixed += ch; escaped = true; continue; }
    if (ch === '"') { inString = !inString; fixed += ch; continue; }
    if (inString) {
      if (ch === '\n') { fixed += '\\n'; continue; }
      if (ch === '\r') { fixed += '\\r'; continue; }
      if (ch === '\t') { fixed += '\\t'; continue; }
      if (ch.charCodeAt(0) < 32) continue;
    }
    fixed += ch;
  }
  fixed = fixed.replace(/,\s*([\]}])/g, '$1');
  try { return JSON.parse(fixed); } catch (_) { /* continue */ }

  // Nuclear option
  let nuclear = src.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  nuclear = nuclear.replace(/"([^"]*?)"/g, (match) => {
    return match.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
  });
  nuclear = nuclear.replace(/,\s*([\]}])/g, '$1');
  try { return JSON.parse(nuclear); } catch (_) { /* continue */ }

  throw new Error('JSON repair failed');
}

const VALID_TYPES = ['skill', 'mcp-server', 'cursor-rules', 'n8n-node', 'workflow', 'langchain-tool', 'crewai-tool'];

function validateEnrichment(p, hint) {
  if (!p || typeof p !== 'object') return null;
  if (!VALID_TYPES.includes(p.artifact_type)) p.artifact_type = hint;
  if (!GEMINI_CATEGORIES.includes(p.category)) p.category = 'AI / ML';
  if (Array.isArray(p.compatible_platforms)) {
    p.compatible_platforms = p.compatible_platforms.filter(pl => GEMINI_PLATFORMS.includes(pl));
  }
  return p;
}

function buildGeminiPrompt(items) {
  const repoSummaries = items.map((item, idx) => {
    const excerpt = item.readme ? item.readme.substring(0, 1800) : 'No README.';
    return `### REPO_${idx}
- full_name: ${item.full_name}
- description: ${item.description || '(none)'}
- language: ${item.language || 'Unknown'}
- stars: ${item.stars} | forks: ${item.forks}
- topics: ${item.topics_str || '(none)'}
- updated: ${item.github_updated_at}
README excerpt:
${excerpt}`;
  }).join('\n\n');

  return `You are classifying ${items.length} GitHub repositories as "agent artifacts" for OneSkill.dev. Return ONLY a valid JSON array of ${items.length} objects — one per repo, same order. No markdown fences, no extra text.

${repoSummaries}

## Classification rules
artifact_type must be EXACTLY one of: skill, mcp-server, cursor-rules, n8n-node, workflow, langchain-tool, crewai-tool
category must be EXACTLY one of: ${GEMINI_CATEGORIES.join(', ')}
compatible_platforms must be a subset of: ${GEMINI_PLATFORMS.join(', ')}
tags: 3–7 lowercase hyphenated keywords (e.g. "web-scraping", "auth", "react")

Heuristics:
- MCP server → "mcp-server"  |  Cursor rules → "cursor-rules"  |  Skill (SKILL.md) → "skill"
- n8n community node → "n8n-node"  |  Workflow/orchestration → "workflow"
- LangChain tool → "langchain-tool"  |  CrewAI tool → "crewai-tool"

Install patterns: MCP/npm: "npx -y <pkg>" | Skills: "npx skills add <owner>/<repo>" | pip: "pip install <pkg>" | Cursor: "curl -o .cursorrules <url>" | n8n: "npm install <pkg>"

Each object shape:
{"artifact_type":"...","long_description":"2-3 sentences.","category":"...","tags":[...],"compatible_platforms":[...],"install_command":"...","npm_package_name":null,"meta_title":"under 60 chars","meta_description":"under 160 chars"}`;
}

/**
 * Enrich a single raw_repo row via Gemini. Returns enrichment result or null.
 */
async function enrichOneWithGemini(item, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      // On last attempt, drop responseMimeType to let Gemini respond freely
      const isLastAttempt = attempt === retries;
      const genConfig = isLastAttempt
        ? { temperature: 0.05, maxOutputTokens: 800 }
        : { temperature: 0.1, maxOutputTokens: 800, responseMimeType: 'application/json' };

      const res = await fetch(`${GEMINI_URL}?key=${ENV.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildGeminiPrompt([item]) }] }],
          generationConfig: genConfig,
        }),
      });
      if (res.status === 429) { await sleep(Math.pow(2, attempt + 1) * 5000); continue; }
      if (!res.ok) {
        const errText = await res.text();
        log('  ', `Gemini ${res.status} for ${item.full_name}: ${errText.substring(0, 150)}`);
        throw new Error(`${res.status}`);
      }
      const data = await res.json();

      // Check for blocked/empty responses
      const finishReason = data.candidates?.[0]?.finishReason;
      if (finishReason && finishReason !== 'STOP') {
        log('  ', `Gemini finish=${finishReason} for ${item.full_name}`);
      }

      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!raw) {
        log('  ', `Gemini returned empty text for ${item.full_name}`);
        throw new Error('Empty response');
      }

      const parsed = repairJSON(raw);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      return validateEnrichment(arr[0], item.type_hint);
    } catch (err) {
      log('  ', `[1x1] attempt ${attempt + 1}/${retries + 1} for ${item.full_name}: ${err.message.substring(0, 80)}`);
      if (attempt === retries) return null;
      await sleep(3000);
    }
  }
  return null;
}

/**
 * Enrich a batch of raw_repos via a SINGLE Gemini call.
 * Falls back to individual calls if batch parsing fails.
 */
async function enrichBatchWithGemini(items, retries = 2) {
  const prompt = buildGeminiPrompt(items);
  const repoNames = items.map(i => i.full_name).join(', ');

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${GEMINI_URL}?key=${ENV.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.1, maxOutputTokens: items.length * 500, responseMimeType: 'application/json' },
        }),
      });

      if (res.status === 429) {
        const wait = Math.pow(2, attempt + 1) * 5000;
        log('⏳', `Gemini 429 — backing off ${(wait / 1000).toFixed(0)}s`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`HTTP ${res.status}: ${errText.substring(0, 200)}`);
      }

      const data = await res.json();

      // Check for blocked/filtered responses
      const finishReason = data.candidates?.[0]?.finishReason;
      if (finishReason && finishReason !== 'STOP') {
        log('⚠️', `Gemini finish=${finishReason} for batch [${repoNames.substring(0, 80)}]`);
      }

      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      if (!raw) {
        log('⚠️', `Gemini returned empty text for batch`);
        throw new Error('Empty response');
      }

      // Log first 200 chars of raw response for debugging
      log('  ', `Raw (${raw.length} chars): ${raw.substring(0, 200).replace(/\n/g, '\\n')}...`);

      const parsed = repairJSON(raw);

      if (!Array.isArray(parsed)) throw new Error(`Expected array, got ${typeof parsed}`);
      while (parsed.length < items.length) parsed.push(null);

      log('  ', `✅ Batch parsed: ${parsed.filter(Boolean).length}/${items.length} valid`);
      return parsed.map((p, idx) => validateEnrichment(p, items[idx].type_hint));

    } catch (err) {
      if (attempt === retries) {
        log('⚠️', `Batch of ${items.length} failed after ${retries + 1} attempts — falling back to 1-by-1`);
        const results = [];
        for (const item of items) {
          const result = await enrichOneWithGemini(item);
          results.push(result);
          if (result) log('  ', `✅ ${item.full_name} enriched individually`);
          await sleep(1000);
        }
        log('  ', `1-by-1 fallback: ${results.filter(Boolean).length}/${items.length} succeeded`);
        return results;
      }
      log('  ', `Gemini batch retry ${attempt + 1}: ${err.message.substring(0, 120)}`);
      await sleep(4000);
    }
  }
  return items.map(() => null);
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
      const { _platform_labels, _type_slug, ...row } = a;
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

  // Fetch pending/failed rows, ordered by stars DESC (enrich popular repos first)
  // Only retry failed rows if they haven't exceeded MAX_ENRICH_ATTEMPTS
  const pending = await sbGet(
    'raw_repos',
    `enrichment_status=in.(pending,failed)` +
    `&enrich_attempts=lt.${MAX_ENRICH_ATTEMPTS}` +
    `&order=stars.desc` +
    `&limit=${limit}` +
    `&select=id,github_full_name,owner_login,repo_name,description,language,stars,forks,open_issues,license,default_branch,topics,github_url,owner_avatar_url,owner_html_url,github_created_at,github_updated_at,readme_raw,type_hint,enrich_attempts`
  );

  if (pending.length === 0) {
    log('✅', 'No unenriched repos to process');
    return 0;
  }

  log('📦', `Found ${pending.length} repos to enrich`);

  let totalUpserted = 0;
  let enriched = 0;
  let failed = 0;

  // Process in Gemini-batch-sized chunks
  for (let start = 0; start < pending.length; start += GEMINI_BATCH) {
    const chunk = pending.slice(start, start + GEMINI_BATCH);

    // Prepare items for Gemini prompt
    const geminiItems = chunk.map(row => ({
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

    log('🤖', `Enriching batch ${Math.floor(start / GEMINI_BATCH) + 1}/${Math.ceil(pending.length / GEMINI_BATCH)} (${chunk.length} repos)`);

    const enrichments = await enrichBatchWithGemini(geminiItems);
    await sleep(800);

    const artifacts = [];
    for (let j = 0; j < chunk.length; j++) {
      const rawRepo = chunk[j];
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

      // Increment attempt counter even on success (for tracking)
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
  const incrementalQueries = SEARCH_QUERIES.map(sq => ({
    ...sq,
    pages: Math.min(sq.pages, 5),
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
    // Discover only — no Gemini needed
    await runDiscover(SEARCH_QUERIES, 0);
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
