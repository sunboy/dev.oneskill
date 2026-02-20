#!/usr/bin/env node

/**
 * OneSkill GitHub Artifact Scraper  v2
 *
 * Discovers agent artifacts on GitHub (skills, MCP servers, Cursor rules,
 * n8n nodes, workflows, LangChain tools, CrewAI tools), enriches metadata
 * via Gemini Flash, and upserts into Supabase's normalized schema.
 *
 * Supabase tables used:
 *   artifact_types   – lookup (slug → uuid)
 *   categories       – lookup (slug → uuid)
 *   platforms        – lookup (slug → uuid)
 *   contributors     – upsert by github_username
 *   artifacts        – main table (uuid PK, FK refs)
 *   artifact_platforms – junction table (artifact_id, platform_id)
 *
 * Runs every 6 h via GitHub Actions.  Max ~150 repos per run.
 */

// ─────────────────────────── Configuration ───────────────────────────

const MAX_REPOS        = 150;
const BATCH_SIZE       = 20;
const GEMINI_BATCH     = 10;   // repos per Gemini call (~10x fewer API calls)
const GEMINI_MODEL     = 'gemini-2.5-flash';
const GEMINI_URL       = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ─────────────────────────── Search Queries ──────────────────────────
// hint = slug that maps to artifact_types.slug

const SEARCH_QUERIES = [
  // ── MCP Servers ─────────────────────────────────────────────────────
  { hint: 'mcp-server', q: '"mcp-server" in:name language:TypeScript', sort: 'stars', pages: 3 },
  { hint: 'mcp-server', q: '"mcp-server" in:name language:Python', sort: 'stars', pages: 3 },
  { hint: 'mcp-server', q: 'topic:mcp-server stars:>50', sort: 'stars', pages: 2 },
  { hint: 'mcp-server', q: 'topic:model-context-protocol', sort: 'stars', pages: 2 },
  { hint: 'mcp-server', q: '"@modelcontextprotocol" in:name,description', sort: 'stars', pages: 1 },

  // ── Cursor Rules ────────────────────────────────────────────────────
  { hint: 'cursor-rules', q: 'topic:cursor-rules', sort: 'stars', pages: 2 },
  { hint: 'cursor-rules', q: 'topic:cursorrules', sort: 'stars', pages: 1 },
  { hint: 'cursor-rules', q: '"cursorrules" in:name,description', sort: 'stars', pages: 2 },
  { hint: 'cursor-rules', q: '"cursor rules" in:name,description', sort: 'stars', pages: 1 },

  // ── Skills ──────────────────────────────────────────────────────────
  { hint: 'skill', q: '"agent-skills" in:name', sort: 'stars', pages: 2 },
  { hint: 'skill', q: 'topic:claude-code stars:>100', sort: 'stars', pages: 2 },
  { hint: 'skill', q: 'topic:oneskill', sort: 'stars', pages: 2 },
  { hint: 'skill', q: 'topic:agent-skill', sort: 'stars', pages: 1 },
  { hint: 'skill', q: 'filename:SKILL.md', sort: 'stars', pages: 2 },
  { hint: 'skill', q: '"npx skills add" in:readme', sort: 'stars', pages: 1 },
  { hint: 'skill', q: '"claude-code-skill" in:name,description,topics', sort: 'stars', pages: 1 },

  // ── n8n Nodes ───────────────────────────────────────────────────────
  { hint: 'n8n-node', q: 'topic:n8n-community-node', sort: 'stars', pages: 2 },
  { hint: 'n8n-node', q: 'topic:n8n-node', sort: 'stars', pages: 1 },
  { hint: 'n8n-node', q: '"n8n-nodes-" in:name', sort: 'stars', pages: 1 },
  { hint: 'n8n-node', q: '"n8n community node" in:description', sort: 'stars', pages: 1 },

  // ── Workflows ───────────────────────────────────────────────────────
  { hint: 'workflow', q: 'topic:ai-workflow', sort: 'stars', pages: 1 },
  { hint: 'workflow', q: 'topic:agent-workflow', sort: 'stars', pages: 1 },
  { hint: 'workflow', q: '"ai workflow" in:name,description topic:automation', sort: 'stars', pages: 1 },

  // ── LangChain Tools ─────────────────────────────────────────────────
  { hint: 'langchain-tool', q: 'topic:langchain-tool', sort: 'stars', pages: 2 },
  { hint: 'langchain-tool', q: 'topic:langchain-tools', sort: 'stars', pages: 1 },
  { hint: 'langchain-tool', q: '"langchain tool" in:name,description', sort: 'stars', pages: 1 },

  // ── CrewAI Tools ────────────────────────────────────────────────────
  { hint: 'crewai-tool', q: 'topic:crewai', sort: 'stars', pages: 2 },
  { hint: 'crewai-tool', q: '"crewai" "tool" in:name,description', sort: 'stars', pages: 1 },
  { hint: 'crewai-tool', q: '"crewai_tools" in:readme', sort: 'stars', pages: 1 },
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
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GEMINI_API_KEY'];
  const missing  = required.filter((k) => !ENV[k]);
  if (missing.length) { console.error(`Missing env vars: ${missing.join(', ')}`); process.exit(1); }
  if (!ENV.GITHUB_PAT) log('⚠️', 'No GITHUB_PAT — search rate limit will be 10 req/min');
  log('✅', 'Environment OK');
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
  if (onConflict) headers['Prefer'] = `resolution=merge-duplicates,return=representation`;
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
  'Frontend': 'frontend',
  'Backend': 'backend',
  'DevOps': 'devops',
  'AI / ML': 'ai-ml',
  'Database': 'database',
  'Security': 'security',
  'Automation': 'automation',
  'Web Scraping': 'web-scraping',
  'Research': 'research',
  'Design': 'design',
  'Mobile': 'mobile',
  'Testing': 'testing',
  'Data Engineering': 'data-engineering',
  'Documentation': 'documentation',
  'Productivity': 'productivity',
};

// Default platform labels per artifact type slug
const PLATFORM_DEFAULTS = {
  'skill': ['Claude Code', 'Cursor', 'Windsurf', 'Cline', 'Roo Code', 'OpenCode', 'Kiro CLI', 'GitHub Copilot'],
  'mcp-server': ['Claude Code', 'Cursor', 'Cline', 'Windsurf', 'Roo Code', 'OpenCode', 'Kiro CLI', 'Continue'],
  'cursor-rules': ['Cursor'],
  'n8n-node': ['n8n'],
  'workflow': ['n8n', 'LangChain', 'CrewAI'],
  'langchain-tool': ['LangChain'],
  'crewai-tool': ['CrewAI'],
};

// ─────────────────────────── GitHub API ──────────────────────────────

async function githubFetch(url, raw = false) {
  const headers = {
    Accept: raw ? 'application/vnd.github.v3.raw' : 'application/vnd.github.v3+json',
    'User-Agent': 'OneSkill-Scraper/2.0',
  };
  if (ENV.GITHUB_PAT) headers.Authorization = `token ${ENV.GITHUB_PAT}`;

  const res = await fetch(url, { headers });

  const remaining = res.headers.get('x-ratelimit-remaining');
  if (remaining !== null && parseInt(remaining, 10) < 3) {
    const reset = parseInt(res.headers.get('x-ratelimit-reset') || '0', 10) * 1000;
    const wait  = Math.max(0, reset - Date.now()) + 1500;
    log('⏳', `Rate limit low (${remaining} left) — sleeping ${(wait / 1000).toFixed(0)}s`);
    await sleep(wait);
  }

  if (res.status === 403 || res.status === 429) {
    log('🛑', `Rate limited (${res.status}) — skipping`);
    return null;
  }
  if (!res.ok) return null;
  return raw ? res.text() : res.json();
}

async function searchRepos(query, sort = 'stars', pages = 1) {
  const repos = [];
  for (let page = 1; page <= pages; page++) {
    const url =
      `https://api.github.com/search/repositories` +
      `?q=${encodeURIComponent(query)}&sort=${sort}&order=desc&per_page=30&page=${page}`;

    const data = await githubFetch(url);
    if (!data || !data.items) break;
    repos.push(...data.items);
    if (data.items.length < 30) break;
    await sleep(2200);
  }
  return repos;
}

async function fetchReadme(owner, repo) {
  const url = `https://api.github.com/repos/${owner}/${repo}/readme`;
  const text = await githubFetch(url, true);
  return typeof text === 'string' ? text : null;
}

// ─────────────────────────── Gemini API ──────────────────────────────

const GEMINI_CATEGORIES = Object.keys(CATEGORY_LABEL_TO_SLUG);
const GEMINI_PLATFORMS  = [
  'Claude Code', 'Cursor', 'Cline', 'Windsurf', 'Roo Code', 'OpenCode',
  'Kiro CLI', 'Continue', 'GitHub Copilot', 'Aider', 'Codex CLI', 'Amp',
  'Devin', 'Replit Agent', 'Bolt', 'Lovable', 'v0', 'Manus', 'OpenClaw',
  'Antigravity', 'n8n', 'LangChain', 'CrewAI', 'AutoGen', 'Semantic Kernel',
  'Zapier', 'Make', 'Activepieces', 'SuperAgent', 'E2B', 'Composio',
  'Toolhouse', 'Browserbase', 'Steel', 'Firecrawl', 'Apify', 'Julep', 'Letta',
];

/**
 * Enrich a batch of repos in a SINGLE Gemini call.
 * @param {Array<{ repo: object, readme: string|null, hint: string }>} items
 * @returns {Promise<Array<object|null>>}  enrichment per item (same order)
 */
async function enrichBatchWithGemini(items, retries = 2) {
  // Build per-repo summaries (keep each compact to fit context)
  const repoSummaries = items.map((item, idx) => {
    const r = item.repo;
    const excerpt = item.readme ? item.readme.substring(0, 1800) : 'No README.';
    return `### REPO_${idx}
- full_name: ${r.full_name}
- description: ${r.description || '(none)'}
- language: ${r.language || 'Unknown'}
- stars: ${r.stargazers_count} | forks: ${r.forks_count}
- topics: ${(r.topics || []).join(', ') || '(none)'}
- updated: ${r.updated_at}
README excerpt:
${excerpt}
`;
  }).join('\n');

  const prompt = `You are classifying ${items.length} GitHub repositories as "agent artifacts" for OneSkill.dev. Analyze each and return a JSON ARRAY of ${items.length} objects — one per repo, same order. No markdown fences, no explanation, ONLY the JSON array.

${repoSummaries}

## Classification rules
artifact_type must be EXACTLY one of: skill, mcp-server, cursor-rules, n8n-node, workflow, langchain-tool, crewai-tool
category must be EXACTLY one of: ${GEMINI_CATEGORIES.join(', ')}
compatible_platforms must be a subset of: ${GEMINI_PLATFORMS.join(', ')}
tags: 3–7 lowercase hyphenated keywords (e.g. "web-scraping", "auth", "react")

Heuristics for artifact_type:
- MCP server: implements Model Context Protocol, exposes tools/resources via MCP, has "mcp" in name/topics → "mcp-server"
- Cursor rules: contains .cursorrules files, is a collection of cursor rules → "cursor-rules"
- Skill: has SKILL.md, meant for "npx skills add", teaches an agent → "skill"
- n8n node: n8n community node (package name starts with n8n-nodes-) → "n8n-node"
- Workflow: chains agents, automation pipeline/orchestration → "workflow"
- LangChain tool: extends LangChain with custom tools, retrievers → "langchain-tool"
- CrewAI tool: extends CrewAI with tools, agents, tasks → "crewai-tool"

Install command patterns:
- MCP/npm: "npx -y <package-name>" | Skills: "npx skills add <owner>/<repo>"
- pip: "pip install <package-name>" | Cursor: "curl -o .cursorrules <raw-url>"
- n8n: "npm install <package-name>" | Default: "npx skills add <full_name>"

Return a JSON array of exactly ${items.length} objects, each shaped:
{ "artifact_type": "...", "long_description": "2-3 sentences.", "category": "...", "tags": [...], "compatible_platforms": [...], "install_command": "...", "npm_package_name": null, "meta_title": "under 60 chars", "meta_description": "under 160 chars" }`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${GEMINI_URL}?key=${ENV.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.15, maxOutputTokens: items.length * 400 },
        }),
      });

      if (res.status === 429) {
        const wait = Math.pow(2, attempt + 1) * 5000;
        log('⏳', `Gemini 429 — backing off ${(wait / 1000).toFixed(0)}s (attempt ${attempt + 1}/${retries})`);
        await sleep(wait);
        continue;
      }

      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`${res.status}: ${errText.substring(0, 300)}`);
      }

      const data = await res.json();
      const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // Extract JSON array from response
      const arrayMatch = raw.match(/\[[\s\S]*\]/);
      if (!arrayMatch) throw new Error('No JSON array in Gemini response');

      const parsed = JSON.parse(arrayMatch[0]);
      if (!Array.isArray(parsed) || parsed.length !== items.length) {
        throw new Error(`Expected array of ${items.length}, got ${Array.isArray(parsed) ? parsed.length : typeof parsed}`);
      }

      // Validate each result
      const validTypes = ['skill', 'mcp-server', 'cursor-rules', 'n8n-node', 'workflow', 'langchain-tool', 'crewai-tool'];
      return parsed.map((p, idx) => {
        if (!p || typeof p !== 'object') return null;
        if (!validTypes.includes(p.artifact_type)) p.artifact_type = items[idx].hint;
        if (!GEMINI_CATEGORIES.includes(p.category)) p.category = 'AI / ML';
        if (Array.isArray(p.compatible_platforms)) {
          p.compatible_platforms = p.compatible_platforms.filter(pl => GEMINI_PLATFORMS.includes(pl));
        }
        return p;
      });

    } catch (err) {
      if (attempt === retries) {
        log('⚠️', `Gemini batch failed: ${err.message.substring(0, 200)}`);
        return items.map(() => null);   // return nulls so pipeline continues
      }
      log('  ', `Gemini retry ${attempt + 1}: ${err.message.substring(0, 100)}`);
      await sleep(3000);
    }
  }
  return items.map(() => null);
}

// ─────────────────────────── Contributors ────────────────────────────

const contributorCache = new Map(); // github_username → uuid

async function ensureContributor(repo) {
  const username = repo.owner.login;
  if (contributorCache.has(username)) return contributorCache.get(username);

  const row = {
    github_username: username,
    display_name:    username,
    avatar_url:      repo.owner.avatar_url,
    github_url:      repo.owner.html_url,
  };

  try {
    const result = await sbUpsert('contributors', [row], 'github_username');
    const id = result?.[0]?.id;
    if (id) {
      contributorCache.set(username, id);
      return id;
    }
  } catch (err) {
    // contributor might already exist — try to fetch
    log('  ', `Contributor upsert issue for ${username}: ${err.message.substring(0, 100)}`);
  }

  // Fallback: fetch existing
  try {
    const existing = await sbGet('contributors', `github_username=eq.${encodeURIComponent(username)}&select=id&limit=1`);
    if (existing?.[0]?.id) {
      contributorCache.set(username, existing[0].id);
      return existing[0].id;
    }
  } catch (e) { /* ignore */ }

  return null;
}

// ─────────────────────────── Build artifact ──────────────────────────

function buildArtifact(repo, enrichment, typeHint, readme, contributorId) {
  const e = enrichment || {};
  const typeSlug = e.artifact_type || typeHint;
  const catLabel = e.category || 'AI / ML';
  const catSlug  = CATEGORY_LABEL_TO_SLUG[catLabel] || 'ai-ml';

  // Compute trending score
  const stars = repo.stargazers_count || 0;
  const forks = repo.forks_count || 0;
  const daysAgo = (Date.now() - new Date(repo.updated_at).getTime()) / 86400000;
  const starScore    = Math.min(40, Math.floor(Math.log10(Math.max(1, stars)) * 15));
  const forkScore    = Math.min(15, Math.floor(Math.log10(Math.max(1, forks)) * 8));
  const recencyScore = daysAgo < 14 ? 20 : daysAgo < 30 ? 15 : daysAgo < 90 ? 8 : 0;
  const trendingScore = Math.min(100, starScore + forkScore + recencyScore);

  // Generate slug from full_name
  const slug = repo.full_name.replace('/', '-').toLowerCase().replace(/[^a-z0-9-]/g, '');

  // Resolve UUIDs
  const artifactTypeId = TYPE_MAP[typeSlug];
  const categoryId     = CATEGORY_MAP[catSlug];

  if (!artifactTypeId) {
    log('⚠️', `Unknown type slug "${typeSlug}" for ${repo.full_name} — skipping`);
    return null;
  }

  return {
    slug,
    name:                   repo.name,
    description:            (repo.description || '').substring(0, 500),
    long_description:       (e.long_description || repo.description || '').substring(0, 2000),
    artifact_type_id:       artifactTypeId,
    category_id:            categoryId || CATEGORY_MAP['ai-ml'],
    contributor_id:         contributorId,
    github_url:             repo.html_url,
    github_repo_full_name:  repo.full_name,
    default_branch:         repo.default_branch || 'main',
    language:               repo.language || null,
    license:                repo.license?.spdx_id || repo.license?.name || null,
    install_command:        e.install_command || `npx skills add ${repo.full_name}`,
    npm_package_name:       e.npm_package_name || null,
    stars:                  stars,
    forks:                  forks,
    open_issues:            repo.open_issues_count || 0,
    weekly_downloads:       0,
    trending_score:         trendingScore,
    version:                null,
    latest_commit_sha:      null,
    readme_raw:             readme ? readme.substring(0, 50000) : null,
    readme_excerpt:         readme ? readme.substring(0, 500) : null,
    tags:                   Array.isArray(e.tags) ? e.tags.slice(0, 7) : [],
    meta_title:             e.meta_title || `${repo.name} — OneSkill`,
    meta_description:       e.meta_description || (repo.description || '').substring(0, 160),
    status:                 'active',
    source:                 'github_scraper',
    is_featured:            false,
    github_created_at:      repo.created_at,
    github_updated_at:      repo.updated_at,
    last_pipeline_sync:     new Date().toISOString(),
    // Transient — used after upsert for junction table, not sent to artifacts
    _platform_labels:       Array.isArray(e.compatible_platforms) && e.compatible_platforms.length
                              ? e.compatible_platforms
                              : (PLATFORM_DEFAULTS[typeSlug] || []),
    _type_slug:             typeSlug,
  };
}

// ─────────────────────────── Upsert artifacts ────────────────────────

async function upsertArtifacts(artifacts) {
  let upserted = 0;
  for (let start = 0; start < artifacts.length; start += BATCH_SIZE) {
    const batch = artifacts.slice(start, start + BATCH_SIZE);

    // Strip transient fields before sending to Supabase
    const rows = batch.map(a => {
      const { _platform_labels, _type_slug, ...row } = a;
      return row;
    });

    try {
      const result = await sbUpsert('artifacts', rows, 'github_repo_full_name');
      upserted += result.length;

      // Now handle artifact_platforms junction for returned rows
      for (let i = 0; i < result.length; i++) {
        const artifactId = result[i].id;
        const labels = batch[i]._platform_labels || [];
        const junctionRows = [];

        for (const label of labels) {
          const platform = PLATFORM_MAP[label];
          if (platform) {
            junctionRows.push({ artifact_id: artifactId, platform_id: platform.id });
          }
        }

        if (junctionRows.length > 0) {
          try {
            await sbUpsert('artifact_platforms', junctionRows, 'artifact_id,platform_id');
          } catch (err) {
            log('  ', `Junction upsert issue for ${result[i].slug}: ${err.message.substring(0, 100)}`);
          }
        }
      }

      log('💾', `Batch ${Math.floor(start / BATCH_SIZE) + 1}: ${result.length} rows (${upserted} total)`);
    } catch (err) {
      log('❌', `Batch failed: ${err.message.substring(0, 200)}`);
      // Fallback: try one-by-one
      for (let j = 0; j < rows.length; j++) {
        try {
          const result = await sbUpsert('artifacts', [rows[j]], 'github_repo_full_name');
          upserted++;

          // Junction
          const artifactId = result?.[0]?.id;
          if (artifactId) {
            const labels = batch[j]._platform_labels || [];
            const junctionRows = labels
              .map(l => PLATFORM_MAP[l])
              .filter(Boolean)
              .map(p => ({ artifact_id: artifactId, platform_id: p.id }));
            if (junctionRows.length) {
              try { await sbUpsert('artifact_platforms', junctionRows, 'artifact_id,platform_id'); }
              catch (e) { /* ignore */ }
            }
          }
        } catch (e2) {
          log('  ', `Skip: ${e2.message.substring(0, 100)}`);
        }
      }
    }
  }
  return upserted;
}

// ─────────────────────────── Main ────────────────────────────────────

async function main() {
  const startTime = Date.now();
  validateEnv();

  // ── 0. Load lookup tables from Supabase ─────────────────────────────
  await loadLookups();

  // ── 1. Discover repos from GitHub ───────────────────────────────────
  log('🔍', `\nStarting discovery — ${SEARCH_QUERIES.length} search queries\n`);

  /** @type {Map<string, { repo: object, hint: string }>} */
  const repoMap = new Map();
  let searchesRun = 0;

  for (const { hint, q, sort, pages } of SEARCH_QUERIES) {
    if (repoMap.size >= MAX_REPOS) {
      log('📦', `Hit ${MAX_REPOS} cap — stopping search`);
      break;
    }

    log('🔎', `[${hint}] ${q} (${pages}p)`);
    const repos = await searchRepos(q, sort, pages);
    searchesRun++;

    let added = 0;
    for (const repo of repos) {
      if (repoMap.size >= MAX_REPOS) break;
      const key = repo.full_name;
      if (!repoMap.has(key)) {
        repoMap.set(key, { repo, hint });
        added++;
      }
    }
    log('  ', `→ ${repos.length} results, ${added} new (${repoMap.size} total)`);
    await sleep(2500);
  }

  log('📊', `\nDiscovery complete: ${repoMap.size} unique repos from ${searchesRun} queries\n`);

  // ── 2. Fetch READMEs & enrich in batches via Gemini ─────────────────
  const artifacts = [];
  const entries = [...repoMap.entries()];

  // Phase 2a: Fetch all READMEs (parallel-ish, respecting rate limits)
  log('📖', `\nFetching READMEs for ${entries.length} repos\n`);
  const readmeMap = new Map();
  for (let i = 0; i < entries.length; i++) {
    const [key, { repo }] = entries[i];
    if (i > 0 && i % 20 === 0) log('  ', `READMEs: ${i}/${entries.length}`);
    const readme = await fetchReadme(repo.owner.login, repo.name);
    readmeMap.set(key, readme);
    await sleep(400);
  }
  log('📖', `Fetched ${readmeMap.size} READMEs`);

  // Phase 2b: Enrich in batches (GEMINI_BATCH repos per API call)
  log('🤖', `\nEnriching via Gemini (${GEMINI_BATCH} repos/call → ~${Math.ceil(entries.length / GEMINI_BATCH)} calls)\n`);

  for (let start = 0; start < entries.length; start += GEMINI_BATCH) {
    const chunk = entries.slice(start, start + GEMINI_BATCH);
    const batchNum = Math.floor(start / GEMINI_BATCH) + 1;
    const totalBatches = Math.ceil(entries.length / GEMINI_BATCH);
    log('🔄', `Gemini batch ${batchNum}/${totalBatches} (repos ${start + 1}–${start + chunk.length})`);

    // Prepare batch items for Gemini
    const batchItems = chunk.map(([key, { repo, hint }]) => ({
      repo, hint, readme: readmeMap.get(key),
    }));

    // Single Gemini call for the whole batch
    const enrichments = await enrichBatchWithGemini(batchItems);
    await sleep(1000);

    // Build artifacts from enrichments
    for (let j = 0; j < chunk.length; j++) {
      const [key, { repo, hint }] = chunk[j];
      const enrichment = enrichments[j];
      const readme = readmeMap.get(key);

      const contributorId = await ensureContributor(repo);
      const artifact = buildArtifact(repo, enrichment, hint, readme, contributorId);
      if (artifact) {
        artifacts.push(artifact);
        log('  ', `→ ${key}: ${artifact._type_slug} | score ${artifact.trending_score} | ${artifact._platform_labels.length} platforms`);
      }
    }
  }

  log('✅', `\nEnriched ${artifacts.length} artifacts\n`);

  // ── 3. Upsert to Supabase ──────────────────────────────────────────
  const upserted = await upsertArtifacts(artifacts);

  // ── 4. Summary ─────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const typeCount = {};
  for (const a of artifacts) typeCount[a._type_slug] = (typeCount[a._type_slug] || 0) + 1;

  log('🏁', `\nDone in ${elapsed}s`);
  log('  ', `Repos discovered:    ${repoMap.size}`);
  log('  ', `Artifacts upserted:  ${upserted}`);
  log('  ', `By type:`);
  for (const [t, c] of Object.entries(typeCount).sort((a, b) => b[1] - a[1])) {
    log('  ', `  ${t}: ${c}`);
  }
}

main().catch((err) => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
