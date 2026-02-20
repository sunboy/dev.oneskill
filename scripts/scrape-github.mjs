#!/usr/bin/env node

/**
 * OneSkill GitHub Artifact Scraper
 *
 * Discovers agent artifacts on GitHub (skills, MCP servers, Cursor rules,
 * n8n nodes, workflows, LangChain tools, CrewAI tools), enriches metadata
 * via Gemini Flash, and upserts into Supabase.
 *
 * Runs every 6h via GitHub Actions.  Max ~150 repos per run.
 */

// ─────────────────────────── Configuration ───────────────────────────

const ARTIFACT_TYPES = [
  'skill',
  'mcp_server',
  'cursor_rule',
  'n8n_node',
  'workflow',
  'langchain_tool',
  'crewai_tool',
];

const CATEGORIES = [
  'Automation', 'Code Generation', 'Data Analysis', 'DevOps',
  'Documentation', 'Frontend', 'Backend', 'Research',
  'Security', 'Testing', 'Web Scraping', 'Workflow', 'AI / ML',
];

const ALL_PLATFORMS = [
  'Claude Code', 'Cursor', 'Antigravity', 'OpenClaw', 'Codex', 'Windsurf',
  'GitHub Copilot', 'Gemini CLI', 'Cline', 'Roo Code', 'Kiro CLI', 'OpenCode',
  'Goose', 'Augment', 'Trae', 'Qwen Code', 'Replit', 'Amp', 'Kimi Code CLI',
  'CodeBuddy', 'Command Code', 'Continue', 'Crush', 'Droid', 'iFlow CLI',
  'Junie', 'Kilo Code', 'Kode', 'MCPJam', 'Mistral Vibe', 'Mux', 'OpenHands',
  'Pi', 'Qoder', 'Trae CN', 'Zencoder', 'n8n', 'LangChain', 'CrewAI',
];

// Default platform sets when Gemini can't detect
const PLATFORM_DEFAULTS = {
  skill: [
    'Claude Code', 'Cursor', 'Antigravity', 'OpenClaw', 'Codex', 'Windsurf',
    'GitHub Copilot', 'Gemini CLI', 'Cline', 'Roo Code', 'Kiro CLI',
  ],
  mcp_server: [
    'Claude Code', 'Cursor', 'Cline', 'Windsurf', 'Roo Code', 'OpenCode',
    'Kiro CLI', 'Continue',
  ],
  cursor_rule: ['Cursor'],
  n8n_node: ['n8n'],
  workflow: ['n8n', 'LangChain', 'CrewAI'],
  langchain_tool: ['LangChain'],
  crewai_tool: ['CrewAI'],
};

/*
 * Search queries — we cast a WIDE net and let Gemini classify.
 * Duplicates across queries are deduped by owner/repo key.
 *
 * GitHub Search API limits: 30 req/min (auth'd), 10 req/min (unauth'd).
 * We paginate up to N pages (30 results each) and sleep between requests.
 */
const SEARCH_QUERIES = [
  // ── MCP Servers ─────────────────────────────────────────────────────
  { hint: 'mcp_server', q: 'topic:mcp-server', sort: 'stars', pages: 3 },
  { hint: 'mcp_server', q: 'topic:model-context-protocol', sort: 'stars', pages: 2 },
  { hint: 'mcp_server', q: '"mcp server" in:name,description', sort: 'stars', pages: 2 },
  { hint: 'mcp_server', q: 'filename:mcp.json', sort: 'stars', pages: 1 },
  { hint: 'mcp_server', q: '"@modelcontextprotocol" in:name,description', sort: 'stars', pages: 1 },

  // ── Cursor Rules ────────────────────────────────────────────────────
  { hint: 'cursor_rule', q: 'topic:cursor-rules', sort: 'stars', pages: 2 },
  { hint: 'cursor_rule', q: 'topic:cursorrules', sort: 'stars', pages: 1 },
  { hint: 'cursor_rule', q: '"cursorrules" in:name,description', sort: 'stars', pages: 2 },
  { hint: 'cursor_rule', q: '"cursor rules" in:name,description', sort: 'stars', pages: 1 },

  // ── Skills (SKILL.md / agent-skills / oneskill) ─────────────────────
  { hint: 'skill', q: 'topic:oneskill', sort: 'stars', pages: 2 },
  { hint: 'skill', q: 'topic:agent-skill', sort: 'stars', pages: 1 },
  { hint: 'skill', q: 'topic:claude-code-skill', sort: 'stars', pages: 1 },
  { hint: 'skill', q: 'filename:SKILL.md', sort: 'stars', pages: 2 },
  { hint: 'skill', q: '"npx skills add" in:readme', sort: 'stars', pages: 1 },
  { hint: 'skill', q: '"agent skill" in:name,description', sort: 'stars', pages: 1 },

  // ── n8n Nodes ───────────────────────────────────────────────────────
  { hint: 'n8n_node', q: 'topic:n8n-community-node', sort: 'stars', pages: 2 },
  { hint: 'n8n_node', q: 'topic:n8n-node', sort: 'stars', pages: 1 },
  { hint: 'n8n_node', q: '"n8n-nodes-" in:name', sort: 'stars', pages: 1 },
  { hint: 'n8n_node', q: '"n8n community node" in:description', sort: 'stars', pages: 1 },

  // ── Workflows ───────────────────────────────────────────────────────
  { hint: 'workflow', q: 'topic:ai-workflow', sort: 'stars', pages: 1 },
  { hint: 'workflow', q: 'topic:agent-workflow', sort: 'stars', pages: 1 },
  { hint: 'workflow', q: '"ai workflow" in:name,description topic:automation', sort: 'stars', pages: 1 },

  // ── LangChain Tools ─────────────────────────────────────────────────
  { hint: 'langchain_tool', q: 'topic:langchain-tool', sort: 'stars', pages: 2 },
  { hint: 'langchain_tool', q: 'topic:langchain-tools', sort: 'stars', pages: 1 },
  { hint: 'langchain_tool', q: '"langchain tool" in:name,description', sort: 'stars', pages: 1 },

  // ── CrewAI Tools ────────────────────────────────────────────────────
  { hint: 'crewai_tool', q: 'topic:crewai-tool', sort: 'stars', pages: 2 },
  { hint: 'crewai_tool', q: 'topic:crewai', sort: 'stars', pages: 1 },
  { hint: 'crewai_tool', q: '"crewai" in:name,description topic:ai-agents', sort: 'stars', pages: 1 },
];

const MAX_REPOS = 150;        // hard cap per run
const BATCH_SIZE = 20;        // Supabase upsert batch size
const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// ─────────────────────────── Helpers ─────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(emoji, msg) {
  console.log(`${emoji}  ${msg}`);
}

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
  if (missing.length) {
    console.error(`Missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (!ENV.GITHUB_PAT) {
    log('⚠️', 'No GITHUB_PAT — search rate limit will be 10 req/min (unauthed)');
  }
  log('✅', 'Environment OK');
}

// ─────────────────────────── GitHub API ──────────────────────────────

async function githubFetch(url, raw = false) {
  const headers = {
    Accept: raw
      ? 'application/vnd.github.v3.raw'
      : 'application/vnd.github.v3+json',
    'User-Agent': 'OneSkill-Scraper/1.0',
  };
  if (ENV.GITHUB_PAT) headers.Authorization = `token ${ENV.GITHUB_PAT}`;

  const res = await fetch(url, { headers });

  // Rate-limit handling
  const remaining = res.headers.get('x-ratelimit-remaining');
  if (remaining !== null && parseInt(remaining, 10) < 3) {
    const reset = parseInt(res.headers.get('x-ratelimit-reset') || '0', 10) * 1000;
    const wait  = Math.max(0, reset - Date.now()) + 1000;
    log('⏳', `Rate limit low (${remaining} left) — sleeping ${(wait / 1000).toFixed(0)}s`);
    await sleep(wait);
  }

  if (res.status === 403 || res.status === 429) {
    log('🛑', 'Rate limited — stopping this request');
    return null;
  }
  if (!res.ok) return null;

  return raw ? res.text() : res.json();
}

/**
 * Search GitHub repos with pagination.
 */
async function searchRepos(query, sort = 'stars', pages = 1) {
  const repos = [];
  for (let page = 1; page <= pages; page++) {
    const url =
      `https://api.github.com/search/repositories` +
      `?q=${encodeURIComponent(query)}` +
      `&sort=${sort}&order=desc&per_page=30&page=${page}`;

    const data = await githubFetch(url);
    if (!data || !data.items) break;

    repos.push(...data.items);
    if (data.items.length < 30) break; // last page

    await sleep(2200); // stay under 30 req/min for search
  }
  return repos;
}

/**
 * Fetch raw README markdown for a repo.
 */
async function fetchReadme(owner, repo) {
  const url = `https://api.github.com/repos/${owner}/${repo}/readme`;
  const text = await githubFetch(url, true);
  return typeof text === 'string' ? text : null;
}

// ─────────────────────────── Gemini API ──────────────────────────────

async function enrichWithGemini(repo, readme, typeHint) {
  const readmeExcerpt = readme ? readme.substring(0, 2000) : 'No README found.';

  const prompt = `You are classifying a GitHub repository as an "agent artifact" for an open directory called OneSkill. Analyze the repository and return a single JSON object — no markdown fences, no explanation, only the JSON.

## Repository
- Owner: ${repo.owner.login}
- Name: ${repo.name}
- Full name: ${repo.full_name}
- Description: ${repo.description || '(none)'}
- Language: ${repo.language || 'Unknown'}
- Stars: ${repo.stargazers_count}
- Forks: ${repo.forks_count}
- Topics: ${(repo.topics || []).join(', ') || '(none)'}
- Updated: ${repo.updated_at}

## README excerpt (first 2000 chars)
${readmeExcerpt}

## Classification rules
artifact_type must be EXACTLY one of: ${ARTIFACT_TYPES.join(', ')}
category must be EXACTLY one of: ${CATEGORIES.join(', ')}
compatible_platforms must be a subset of: ${ALL_PLATFORMS.join(', ')}
tags: 3–7 lowercase hyphenated keywords (e.g. "web-scraping", "auth", "react")

Use these heuristics to determine artifact_type:
- If it implements the Model Context Protocol (MCP), exposes tools/resources via MCP, has "mcp" in name/topics, or has an mcp.json → mcp_server
- If it contains .cursorrules files, or is a collection of cursor rules → cursor_rule
- If it has SKILL.md, is meant for "npx skills add", or teaches an agent how to do tasks → skill
- If it is an n8n community node (package name starts with n8n-nodes-) → n8n_node
- If it chains multiple agents, automation steps, or is a pipeline/orchestration tool → workflow
- If it extends LangChain with custom tools, retrievers, or chains → langchain_tool
- If it extends CrewAI with tools, agents, or tasks → crewai_tool

Trending score (0–100): Use this formula:
- Base: min(40, floor(log10(stars + 1) * 15))
- Add 20 if updated in last 14 days
- Add 15 if updated in last 30 days (but not last 14)
- Add min(15, floor(log10(forks + 1) * 8))
- Add 10 if description mentions "official" or "production"
- Cap at 100

Install command:
- For MCP servers published on npm: "npx <package-name>" or "npx -y <package-name>"
- For skills: "npx skills add <owner>/<repo>"
- For pip packages: "pip install <package-name>"
- For cursor rules collections: "curl -o .cursorrules <raw-github-url-to-file>"
- For n8n nodes: "npm install <package-name>" (check package.json name if possible)
- If unsure, use "npx skills add ${repo.owner.login}/${repo.name}"

## Required JSON shape (return ONLY this, no other text)
{
  "artifact_type": "...",
  "long_description": "2-3 sentence description of what this does and why it is useful for developers or agents.",
  "category": "...",
  "tags": ["...", "..."],
  "compatible_platforms": ["...", "..."],
  "install_command": "...",
  "trending_score": 0
}`;

  try {
    const res = await fetch(`${GEMINI_URL}?key=${ENV.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 800 },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`${res.status}: ${errText.substring(0, 200)}`);
    }

    const data = await res.json();
    const raw  = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('No JSON in Gemini response');

    const parsed = JSON.parse(match[0]);

    // Validate artifact_type
    if (!ARTIFACT_TYPES.includes(parsed.artifact_type)) {
      parsed.artifact_type = typeHint;
    }
    // Validate category
    if (!CATEGORIES.includes(parsed.category)) {
      parsed.category = 'AI / ML';
    }
    // Filter platforms to only known ones
    if (Array.isArray(parsed.compatible_platforms)) {
      parsed.compatible_platforms = parsed.compatible_platforms.filter((p) =>
        ALL_PLATFORMS.includes(p)
      );
    }
    // Clamp trending score
    parsed.trending_score = Math.max(0, Math.min(100, parsed.trending_score || 0));

    return parsed;
  } catch (err) {
    log('⚠️', `Gemini failed for ${repo.full_name}: ${err.message}`);
    return null;
  }
}

// ─────────────────────────── Supabase API ────────────────────────────

async function upsertBatch(artifacts) {
  const res = await fetch(`${ENV.SUPABASE_URL}/rest/v1/artifacts`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      Authorization:   `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`,
      apikey:          ENV.SUPABASE_SERVICE_ROLE_KEY,
      Prefer:          'resolution=merge-duplicates',
    },
    body: JSON.stringify(artifacts),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text.substring(0, 300)}`);
  }
  return artifacts.length;
}

// ─────────────────────────── Build artifact ──────────────────────────

function buildArtifact(repo, enrichment, typeHint, readme) {
  const e = enrichment || {};
  const artifactType = e.artifact_type || typeHint;

  // Compute a fallback trending score from repo signals
  const starScore    = Math.min(40, Math.floor(Math.log10(Math.max(1, repo.stargazers_count)) * 15));
  const forkScore    = Math.min(15, Math.floor(Math.log10(Math.max(1, repo.forks_count)) * 8));
  const daysAgo      = (Date.now() - new Date(repo.updated_at).getTime()) / 86400000;
  const recencyScore = daysAgo < 14 ? 20 : daysAgo < 30 ? 15 : daysAgo < 90 ? 8 : 0;
  const fallbackTrending = Math.min(100, starScore + forkScore + recencyScore);

  return {
    id:                    repo.full_name.replace('/', '-').toLowerCase(),
    name:                  repo.name,
    description:           repo.description || '',
    long_description:      e.long_description || repo.description || '',
    author:                repo.owner.login,
    author_github:         repo.owner.login,
    github_url:            repo.html_url,
    stars:                 repo.stargazers_count,
    forks:                 repo.forks_count,
    last_updated:          repo.updated_at,
    category:              e.category || 'AI / ML',
    tags:                  Array.isArray(e.tags) ? e.tags.slice(0, 7) : [],
    artifact_type:         artifactType,
    compatible_platforms:  Array.isArray(e.compatible_platforms) && e.compatible_platforms.length
                             ? e.compatible_platforms
                             : (PLATFORM_DEFAULTS[artifactType] || []),
    language:              repo.language || null,
    license:               repo.license?.spdx_id || repo.license?.name || null,
    version:               null,
    install_command:        e.install_command || `npx skills add ${repo.full_name}`,
    npx_skills_command:    artifactType === 'skill'
                             ? `npx skills add ${repo.full_name}`
                             : null,
    weekly_downloads:      0,
    verified:              false,
    is_featured:           false,
    trending_score:        e.trending_score || fallbackTrending,
    readme:                readme ? readme.substring(0, 10000) : null,
  };
}

// ─────────────────────────── Main ────────────────────────────────────

async function main() {
  const startTime = Date.now();
  validateEnv();

  // ── 1. Discover repos ──────────────────────────────────────────────
  log('🔍', `Starting discovery — ${SEARCH_QUERIES.length} search queries\n`);

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

    // Pause between search queries to respect rate limits
    await sleep(2500);
  }

  log('📊', `\nDiscovery complete: ${repoMap.size} unique repos from ${searchesRun} queries\n`);

  // ── 2. Enrich & build artifacts ────────────────────────────────────
  const artifacts = [];
  let i = 0;

  for (const [key, { repo, hint }] of repoMap) {
    i++;
    const pct = ((i / repoMap.size) * 100).toFixed(0);
    log('🔄', `[${i}/${repoMap.size}] (${pct}%) ${key}`);

    // Fetch README
    const readme = await fetchReadme(repo.owner.login, repo.name);
    await sleep(600);

    // Enrich via Gemini
    const enrichment = await enrichWithGemini(repo, readme, hint);
    await sleep(400);

    const artifact = buildArtifact(repo, enrichment, hint, readme);
    artifacts.push(artifact);

    log('  ', `→ ${artifact.artifact_type} | ${artifact.category} | score ${artifact.trending_score}`);
  }

  log('✅', `\nEnriched ${artifacts.length} artifacts\n`);

  // ── 3. Upsert to Supabase in batches ──────────────────────────────
  let upserted = 0;
  for (let start = 0; start < artifacts.length; start += BATCH_SIZE) {
    const batch = artifacts.slice(start, start + BATCH_SIZE);
    try {
      await upsertBatch(batch);
      upserted += batch.length;
      log('💾', `Upserted batch ${Math.floor(start / BATCH_SIZE) + 1} (${batch.length} rows, ${upserted} total)`);
    } catch (err) {
      log('❌', `Batch upsert failed: ${err.message}`);
      // Fallback: try one-by-one
      for (const a of batch) {
        try {
          await upsertBatch([a]);
          upserted++;
        } catch (e2) {
          log('  ', `Skip ${a.id}: ${e2.message}`);
        }
      }
    }
  }

  // ── 4. Summary ─────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const types   = {};
  for (const a of artifacts) types[a.artifact_type] = (types[a.artifact_type] || 0) + 1;

  log('🏁', `\nDone in ${elapsed}s`);
  log('  ', `Repos discovered: ${repoMap.size}`);
  log('  ', `Artifacts upserted: ${upserted}`);
  log('  ', `By type:`);
  for (const [t, c] of Object.entries(types).sort((a, b) => b[1] - a[1])) {
    log('  ', `  ${t}: ${c}`);
  }
}

main().catch((err) => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
