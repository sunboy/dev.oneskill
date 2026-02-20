#!/usr/bin/env node

/**
 * OneSkill GitHub Artifact Scraper  v3
 *
 * Two modes:
 *   BULK  (--bulk)  : First-time full index. No repo cap, pages through
 *                     everything, stores cursor in Supabase for resume.
 *   INCREMENTAL     : Default. Picks up new/updated repos since last run.
 *                     Runs every 4h via GitHub Actions.
 *
 * Pipeline:  GitHub Search → README fetch → Gemini enrichment → Supabase upsert
 *
 * Supabase tables:
 *   artifact_types, categories, platforms        – lookups
 *   contributors                                 – upsert by github_username
 *   artifacts                                    – main table (upsert on github_repo_full_name)
 *   artifact_platforms                           – junction table
 *   scraper_state                                – cursor/offset tracking per query
 */

// ─────────────────────────── Configuration ───────────────────────────

const MODE           = process.argv.includes('--bulk') ? 'bulk' : 'incremental';
const BATCH_SIZE     = 20;    // Supabase upsert batch
const GEMINI_BATCH   = 10;    // repos per Gemini call
const GEMINI_MODEL   = 'gemini-2.5-flash';
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Incremental: cap per run to stay within GitHub Actions timeout
const INCREMENTAL_CAP = 300;
// Bulk: process this many per query before moving to next (avoid starving other types)
const BULK_PER_QUERY  = 500;

// GitHub Search API returns max 1000 results per query.
// We use star-range buckets to get past this limit.
const STAR_BUCKETS = [
  'stars:>1000', 'stars:501..1000', 'stars:201..500', 'stars:101..200',
  'stars:51..100', 'stars:21..50', 'stars:11..20', 'stars:6..10',
  'stars:3..5', 'stars:1..2', 'stars:0',
];

// ─────────────────────────── Search Queries ──────────────────────────
// Each query can be "bucketed" by stars to get past the 1000-result GitHub limit.
// pages: max pages to fetch per bucket (30 results/page, max ~33 pages = 1000)
// bucketed: if true, we append each STAR_BUCKET to get full coverage

const SEARCH_QUERIES = [
  // ── MCP Servers (~8,600+) ─────────────────────────────────────────
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

  // ── Cursor Rules (~800+) ──────────────────────────────────────────
  { hint: 'cursor-rules', q: 'topic:cursor-rules',                            sort: 'stars', pages: 34, bucketed: false },
  { hint: 'cursor-rules', q: 'topic:cursorrules',                             sort: 'stars', pages: 34, bucketed: false },
  { hint: 'cursor-rules', q: '"cursorrules" in:name,description',             sort: 'stars', pages: 20, bucketed: false },
  { hint: 'cursor-rules', q: '"cursor rules" in:name,description',            sort: 'stars', pages: 10, bucketed: false },
  { hint: 'cursor-rules', q: '"cursor-rules" in:name',                        sort: 'stars', pages: 10, bucketed: false },
  { hint: 'cursor-rules', q: 'topic:cursor-skills',                           sort: 'stars', pages: 5,  bucketed: false },
  { hint: 'cursor-rules', q: 'filename:.cursorrules path:/',                  sort: 'stars', pages: 20, bucketed: false },

  // ── Skills / Claude Code (~15,000+) ───────────────────────────────
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

  // ── n8n Nodes (~5,800+) ───────────────────────────────────────────
  { hint: 'n8n-node', q: '"n8n-nodes-" in:name',                              sort: 'stars', pages: 34, bucketed: true },
  { hint: 'n8n-node', q: 'topic:n8n-community-node-package',                  sort: 'stars', pages: 34, bucketed: true },
  { hint: 'n8n-node', q: 'topic:n8n-community-node',                          sort: 'stars', pages: 34, bucketed: false },
  { hint: 'n8n-node', q: 'topic:n8n-community-nodes',                         sort: 'stars', pages: 34, bucketed: false },
  { hint: 'n8n-node', q: 'topic:n8n-node',                                    sort: 'stars', pages: 20, bucketed: false },
  { hint: 'n8n-node', q: '"n8n community node" in:description',               sort: 'stars', pages: 10, bucketed: false },
  { hint: 'n8n-node', q: '"n8n-community-node-package" in:readme',            sort: 'stars', pages: 20, bucketed: false },
  { hint: 'n8n-node', q: '"n8n-nodes" in:name language:TypeScript',           sort: 'stars', pages: 20, bucketed: false },

  // ── Workflows (~thousands) ────────────────────────────────────────
  { hint: 'workflow', q: 'topic:ai-workflow',                                  sort: 'stars', pages: 20, bucketed: false },
  { hint: 'workflow', q: 'topic:agent-workflow',                               sort: 'stars', pages: 20, bucketed: false },
  { hint: 'workflow', q: 'topic:agentic-workflow',                             sort: 'stars', pages: 20, bucketed: false },
  { hint: 'workflow', q: 'topic:langgraph',                                    sort: 'stars', pages: 34, bucketed: false },
  { hint: 'workflow', q: 'topic:agent-orchestration',                          sort: 'stars', pages: 10, bucketed: false },
  { hint: 'workflow', q: '"agent workflow" in:name,description',               sort: 'stars', pages: 10, bucketed: false },
  { hint: 'workflow', q: '"ai workflow" in:name,description',                  sort: 'stars', pages: 10, bucketed: false },
  { hint: 'workflow', q: 'topic:autogen',                                      sort: 'stars', pages: 10, bucketed: false },

  // ── LangChain Tools (~1,000+) ─────────────────────────────────────
  { hint: 'langchain-tool', q: 'topic:langchain-tool',                        sort: 'stars', pages: 20, bucketed: false },
  { hint: 'langchain-tool', q: 'topic:langchain-tools',                       sort: 'stars', pages: 20, bucketed: false },
  { hint: 'langchain-tool', q: '"langchain" "tool" in:name,description',      sort: 'stars', pages: 34, bucketed: true },
  { hint: 'langchain-tool', q: '"langchain-community" in:name',               sort: 'stars', pages: 10, bucketed: false },
  { hint: 'langchain-tool', q: 'topic:langchain language:python',             sort: 'stars', pages: 20, bucketed: false },
  { hint: 'langchain-tool', q: '"langchain" "integration" in:name,description', sort: 'stars', pages: 10, bucketed: false },

  // ── CrewAI Tools (~500+) ──────────────────────────────────────────
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
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'GEMINI_API_KEY'];
  const missing  = required.filter((k) => !ENV[k]);
  if (missing.length) { console.error(`Missing env vars: ${missing.join(', ')}`); process.exit(1); }
  if (!ENV.GITHUB_PAT) log('⚠️', 'No GITHUB_PAT — search rate limit will be 10 req/min');
  log('✅', `Environment OK — mode: ${MODE}`);
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

// ─────────────────────────── Scraper state (cursor tracking) ────────
// Stores per-query offset so bulk runs can resume across invocations.

async function loadScraperState() {
  try {
    const rows = await sbGet('scraper_state', 'select=query_key,last_page,last_bucket_idx,updated_at');
    const state = {};
    for (const r of rows) state[r.query_key] = r;
    return state;
  } catch {
    // Table might not exist yet — that's OK for first run
    return {};
  }
}

async function saveScraperState(queryKey, lastPage, lastBucketIdx) {
  try {
    await sbUpsert('scraper_state', [{
      query_key: queryKey,
      last_page: lastPage,
      last_bucket_idx: lastBucketIdx,
      updated_at: new Date().toISOString(),
    }], 'query_key');
  } catch (err) {
    log('  ', `State save failed for ${queryKey}: ${err.message.substring(0, 80)}`);
  }
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

async function githubFetch(url, raw = false) {
  const headers = {
    Accept: raw ? 'application/vnd.github.v3.raw' : 'application/vnd.github.v3+json',
    'User-Agent': 'OneSkill-Scraper/3.0',
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
    log('🛑', `Rate limited (${res.status}) — waiting for reset`);
    const reset = parseInt(res.headers.get('x-ratelimit-reset') || '0', 10) * 1000;
    const wait  = Math.max(5000, reset - Date.now()) + 1500;
    await sleep(Math.min(wait, 65000));
    return null;
  }
  if (res.status === 422) return null;  // unprocessable query
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
    if (data.items.length < 30) break;   // last page
    if (page >= 34) break;               // GitHub hard limit: 1000 results (34*30)
    await sleep(2200);                    // Search API: 30 req/min
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

// ─── JSON repair helper ─────────────────────────────────────────────
function repairJSON(raw) {
  let s = raw;

  // 1. Strip markdown code fences
  s = s.replace(/^```(?:json)?\s*/gm, '').replace(/```\s*$/gm, '');

  // 2. Fix trailing commas before ] or }
  s = s.replace(/,\s*([\]}])/g, '$1');

  // 3. Try direct parse first
  try { return JSON.parse(s); } catch (_) { /* continue */ }

  // 4. Extract JSON array
  const m = s.match(/\[[\s\S]*\]/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) { /* continue */ } }

  // 5. Fix unescaped newlines/tabs inside JSON string values
  //    Walk character by character to only escape control chars inside strings
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
      // Strip other control chars
      if (ch.charCodeAt(0) < 32) continue;
    }
    fixed += ch;
  }
  // Fix trailing commas again after our edits
  fixed = fixed.replace(/,\s*([\]}])/g, '$1');
  try { return JSON.parse(fixed); } catch (_) { /* continue */ }

  // 6. Nuclear option: strip ALL control chars except structural whitespace
  let nuclear = src.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
  // Escape newlines inside strings (rough heuristic)
  nuclear = nuclear.replace(/"([^"]*?)"/g, (match) => {
    return match.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
  });
  nuclear = nuclear.replace(/,\s*([\]}])/g, '$1');
  try { return JSON.parse(nuclear); } catch (_) { /* continue */ }

  throw new Error('JSON repair failed');
}

// ─── Validate one Gemini enrichment result ──────────────────────────
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

// ─── Build the Gemini prompt for N repos ────────────────────────────
function buildGeminiPrompt(items) {
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

// ─── Call Gemini for a single repo (fallback) ───────────────────────
async function enrichOneWithGemini(item, retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${GEMINI_URL}?key=${ENV.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildGeminiPrompt([item]) }] }],
          generationConfig: { temperature: 0.15, maxOutputTokens: 600, responseMimeType: 'application/json' },
        }),
      });
      if (res.status === 429) { await sleep(Math.pow(2, attempt + 1) * 5000); continue; }
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const parsed = repairJSON(raw);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      return validateEnrichment(arr[0], item.hint);
    } catch (err) {
      if (attempt === retries) return null;
      await sleep(2000);
    }
  }
  return null;
}

/**
 * Enrich a batch of repos in a SINGLE Gemini call.
 * Falls back to individual calls if batch parsing fails.
 */
async function enrichBatchWithGemini(items, retries = 2) {
  const prompt = buildGeminiPrompt(items);

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(`${GEMINI_URL}?key=${ENV.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.15, maxOutputTokens: items.length * 400, responseMimeType: 'application/json' },
        }),
      });

      if (res.status === 429) {
        const wait = Math.pow(2, attempt + 1) * 5000;
        log('⏳', `Gemini 429 — backing off ${(wait / 1000).toFixed(0)}s`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).substring(0, 200)}`);

      const data = await res.json();
      const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      const parsed = repairJSON(raw);

      if (!Array.isArray(parsed)) throw new Error(`Expected array, got ${typeof parsed}`);
      while (parsed.length < items.length) parsed.push(null);

      return parsed.map((p, idx) => validateEnrichment(p, items[idx].hint));

    } catch (err) {
      if (attempt === retries) {
        log('⚠️', `Batch parse failed — falling back to individual calls`);
        const results = [];
        for (const item of items) {
          results.push(await enrichOneWithGemini(item));
          await sleep(300);
        }
        return results;
      }
      log('  ', `Gemini retry ${attempt + 1}: ${err.message.substring(0, 100)}`);
      await sleep(3000);
    }
  }
  return items.map(() => null);
}

// ─────────────────────────── Contributors ────────────────────────────

const contributorCache = new Map();

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

// ─────────────────────────── Build artifact ──────────────────────────

function buildArtifact(repo, enrichment, typeHint, readme, contributorId) {
  const e = enrichment || {};
  const typeSlug = e.artifact_type || typeHint;
  const catLabel = e.category || 'AI / ML';
  const catSlug  = CATEGORY_LABEL_TO_SLUG[catLabel] || 'ai-ml';

  const stars = repo.stargazers_count || 0;
  const forks = repo.forks_count || 0;
  const daysAgo = (Date.now() - new Date(repo.updated_at).getTime()) / 86400000;
  const starScore    = Math.min(40, Math.floor(Math.log10(Math.max(1, stars)) * 15));
  const forkScore    = Math.min(15, Math.floor(Math.log10(Math.max(1, forks)) * 8));
  const recencyScore = daysAgo < 14 ? 20 : daysAgo < 30 ? 15 : daysAgo < 90 ? 8 : 0;
  const trendingScore = Math.min(100, starScore + forkScore + recencyScore);

  const slug = repo.full_name.replace('/', '-').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const artifactTypeId = TYPE_MAP[typeSlug];
  const categoryId     = CATEGORY_MAP[catSlug];

  if (!artifactTypeId) {
    log('⚠️', `Unknown type "${typeSlug}" for ${repo.full_name} — skipping`);
    return null;
  }

  return {
    slug, name: repo.name,
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
    stars, forks,
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
    _platform_labels:       Array.isArray(e.compatible_platforms) && e.compatible_platforms.length
                              ? e.compatible_platforms : (PLATFORM_DEFAULTS[typeSlug] || []),
    _type_slug:             typeSlug,
  };
}

// ─────────────────────────── Upsert artifacts ────────────────────────

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
          catch (err) { log('  ', `Junction issue for ${result[i].slug}: ${err.message.substring(0, 80)}`); }
        }
      }
      log('💾', `Batch upserted: ${result.length} (${upserted} total)`);
    } catch (err) {
      log('❌', `Batch failed: ${err.message.substring(0, 150)}`);
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
          }
        } catch (e2) { log('  ', `Skip: ${e2.message.substring(0, 80)}`); }
      }
    }
  }
  return upserted;
}

// ─────────────────────────── Enrich + upsert a chunk ────────────────
// Shared between bulk and incremental modes

async function enrichAndUpsert(repoMap) {
  const entries = [...repoMap.entries()];
  if (!entries.length) return 0;

  // Fetch READMEs
  log('📖', `Fetching READMEs for ${entries.length} repos`);
  const readmeMap = new Map();
  for (let i = 0; i < entries.length; i++) {
    const [key, { repo }] = entries[i];
    if (i > 0 && i % 50 === 0) log('  ', `READMEs: ${i}/${entries.length}`);
    readmeMap.set(key, await fetchReadme(repo.owner.login, repo.name));
    await sleep(350);
  }

  // Enrich via Gemini in batches
  log('🤖', `Enriching via Gemini (${GEMINI_BATCH}/call → ~${Math.ceil(entries.length / GEMINI_BATCH)} calls)`);
  const artifacts = [];

  for (let start = 0; start < entries.length; start += GEMINI_BATCH) {
    const chunk = entries.slice(start, start + GEMINI_BATCH);
    const batchItems = chunk.map(([key, { repo, hint }]) => ({
      repo, hint, readme: readmeMap.get(key),
    }));

    const enrichments = await enrichBatchWithGemini(batchItems);
    await sleep(800);

    for (let j = 0; j < chunk.length; j++) {
      const [key, { repo, hint }] = chunk[j];
      const contributorId = await ensureContributor(repo);
      const artifact = buildArtifact(repo, enrichments[j], hint, readmeMap.get(key), contributorId);
      if (artifact) artifacts.push(artifact);
    }
  }

  log('✅', `Enriched ${artifacts.length} artifacts — upserting to Supabase`);
  return await upsertArtifacts(artifacts);
}

// ─────────────────────────── Discovery (with bucketing) ─────────────

async function discoverRepos(queries, existingRepoMap, cap) {
  const repoMap = existingRepoMap || new Map();
  let searchesRun = 0;

  for (const queryDef of queries) {
    if (cap && repoMap.size >= cap) {
      log('📦', `Hit ${cap} cap — stopping search`);
      break;
    }

    const { hint, q, sort, pages, bucketed } = queryDef;
    const buckets = bucketed ? STAR_BUCKETS : [''];

    for (const bucket of buckets) {
      if (cap && repoMap.size >= cap) break;

      const fullQuery = bucket ? `${q} ${bucket}` : q;
      const maxPages = Math.min(pages, 34);

      log('🔎', `[${hint}] ${fullQuery} (${maxPages}p)`);
      const repos = await searchRepos(fullQuery, sort, maxPages);
      searchesRun++;

      let added = 0;
      for (const repo of repos) {
        if (cap && repoMap.size >= cap) break;
        const key = repo.full_name;
        if (!repoMap.has(key)) {
          repoMap.set(key, { repo, hint });
          added++;
        }
      }
      log('  ', `→ ${repos.length} results, ${added} new (${repoMap.size} total)`);
      await sleep(2500);

      // If this bucket returned fewer than a full page, skip remaining buckets
      if (repos.length < 30) continue;
    }
  }

  log('📊', `Discovery: ${repoMap.size} unique repos from ${searchesRun} queries`);
  return repoMap;
}

// ─────────────────────────── Main: INCREMENTAL mode ─────────────────

async function runIncremental() {
  log('🔄', `\n═══ INCREMENTAL MODE — cap ${INCREMENTAL_CAP} repos ═══\n`);

  // Use "updated" sort + pushed:>DATE to find recently changed repos
  const since = new Date(Date.now() - 4 * 3600 * 1000).toISOString().split('T')[0];
  const incrementalQueries = SEARCH_QUERIES.map(sq => ({
    ...sq,
    // For incremental: fewer pages, sort by recently updated
    pages: Math.min(sq.pages, 5),
    bucketed: false,
    sort: 'updated',
    q: `${sq.q} pushed:>=${since}`,
  }));

  const repoMap = await discoverRepos(incrementalQueries, new Map(), INCREMENTAL_CAP);
  if (repoMap.size === 0) {
    log('✅', 'No new/updated repos found since last run');
    return;
  }

  const upserted = await enrichAndUpsert(repoMap);
  log('🏁', `Incremental done: ${upserted} artifacts upserted`);
}

// ─────────────────────────── Main: BULK mode ────────────────────────

async function runBulk() {
  log('📦', `\n═══ BULK MODE — full index, no cap ═══\n`);

  // Process all queries, using star buckets for bucketed ones
  const repoMap = await discoverRepos(SEARCH_QUERIES, new Map(), 0);

  log('📊', `\nTotal unique repos discovered: ${repoMap.size}\n`);

  // Process in chunks to avoid OOM and allow progress logging
  const CHUNK = 200;
  const entries = [...repoMap.entries()];
  let totalUpserted = 0;

  for (let start = 0; start < entries.length; start += CHUNK) {
    const chunk = entries.slice(start, start + CHUNK);
    const chunkMap = new Map(chunk);
    log('🔄', `\nProcessing chunk ${Math.floor(start / CHUNK) + 1}/${Math.ceil(entries.length / CHUNK)} (repos ${start + 1}–${start + chunk.length})\n`);
    totalUpserted += await enrichAndUpsert(chunkMap);
  }

  log('🏁', `Bulk done: ${totalUpserted} artifacts upserted from ${repoMap.size} repos`);
}

// ─────────────────────────── Entry point ────────────────────────────

async function main() {
  const startTime = Date.now();
  validateEnv();
  await loadLookups();

  if (MODE === 'bulk') {
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
