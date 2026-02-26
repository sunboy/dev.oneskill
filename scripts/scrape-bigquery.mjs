#!/usr/bin/env node

/**
 * OneSkill BigQuery Scraper — Bulk discovery via GitHub's BigQuery public dataset
 *
 * Uses `bigquery-public-data.github_repos.files` to find repos containing
 * signature files (SKILL.md, .cursorrules, mcp.json, etc.) and
 * `bigquery-public-data.github_repos.contents` to search package.json/setup.py
 * for specific dependencies.
 *
 * This is 100x faster than GitHub Search API for discovery:
 * - No 1000-result cap per query
 * - No star-bucket workarounds
 * - Returns definitive list in seconds
 *
 * Metadata (stars, description, topics) is hydrated via GitHub API afterward,
 * but only for NEW repos not already in raw_repos.
 *
 * Requires:
 *   - GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_CREDENTIALS_JSON env var
 *   - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   - GITHUB_PAT (optional, for metadata hydration)
 *
 * Usage:
 *   node scripts/scrape-bigquery.mjs [--time-budget M]
 */

import { BigQuery } from '@google-cloud/bigquery';

// ─────────────────────────── CLI flags ───────────────────────────

const TIME_BUDGET_ARG = process.argv.indexOf('--time-budget');
const TIME_BUDGET_MIN = TIME_BUDGET_ARG !== -1
  ? parseInt(process.argv[TIME_BUDGET_ARG + 1], 10) || 0
  : 0;
const START_TIME = Date.now();

function timeExpired() {
  if (!TIME_BUDGET_MIN) return false;
  return (Date.now() - START_TIME) / 60000 >= TIME_BUDGET_MIN;
}

// ─────────────────────────── Config ──────────────────────────────

const BATCH_SIZE = 20;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function log(emoji, msg) { console.log(`${emoji}  ${msg}`); }

const ENV = {
  SUPABASE_URL:              process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  GITHUB_PAT:                process.env.GITHUB_PAT || process.env.GITHUB_TOKEN,
  GOOGLE_CREDENTIALS_JSON:   process.env.GOOGLE_CREDENTIALS_JSON,
};

function validateEnv() {
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter(k => !ENV[k]);
  if (missing.length) { console.error(`Missing: ${missing.join(', ')}`); process.exit(1); }
  // BigQuery auth: either GOOGLE_APPLICATION_CREDENTIALS file or inline JSON
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS && !ENV.GOOGLE_CREDENTIALS_JSON) {
    console.error('Missing: GOOGLE_APPLICATION_CREDENTIALS or GOOGLE_CREDENTIALS_JSON');
    process.exit(1);
  }
}

// ─────────────────────────── Supabase ────────────────────────────

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

// ─────────────────────────── BigQuery ────────────────────────────

function createBigQueryClient() {
  const options = { location: 'US' };

  // Support inline JSON credentials (for GitHub Actions secrets)
  if (ENV.GOOGLE_CREDENTIALS_JSON) {
    const creds = JSON.parse(ENV.GOOGLE_CREDENTIALS_JSON);
    options.projectId = creds.project_id;
    options.credentials = creds;
  }

  return new BigQuery(options);
}

/**
 * BigQuery discovery queries.
 * Each returns a list of repo_name (owner/repo format) with a type hint.
 *
 * Strategy:
 * 1. File-based: Find repos containing signature files
 * 2. Content-based: Find repos whose package.json/setup.py reference key deps
 */
const BQ_QUERIES = [
  // ── File-based discovery ──────────────────────────────────────
  {
    name: 'Repos with SKILL.md',
    hint: 'skill',
    sql: `
      SELECT DISTINCT repo_name
      FROM \`bigquery-public-data.github_repos.files\`
      WHERE path = 'SKILL.md' OR path LIKE '%/SKILL.md'
    `,
    bytesEstimate: '30 GB',
  },
  {
    name: 'Repos with .cursorrules',
    hint: 'cursor-rules',
    sql: `
      SELECT DISTINCT repo_name
      FROM \`bigquery-public-data.github_repos.files\`
      WHERE path = '.cursorrules'
    `,
    bytesEstimate: '30 GB',
  },
  {
    name: 'Repos with mcp.json',
    hint: 'mcp-server',
    sql: `
      SELECT DISTINCT repo_name
      FROM \`bigquery-public-data.github_repos.files\`
      WHERE path = 'mcp.json' OR path = 'mcp-config.json'
    `,
    bytesEstimate: '30 GB',
  },

  // ── Content-based discovery: npm packages referencing MCP SDK ──
  {
    name: 'package.json with @modelcontextprotocol/sdk',
    hint: 'mcp-server',
    sql: `
      SELECT DISTINCT repo_name
      FROM \`bigquery-public-data.github_repos.contents\`
      WHERE path = 'package.json'
        AND content LIKE '%@modelcontextprotocol/sdk%'
    `,
    bytesEstimate: '200 GB',
  },
  {
    name: 'package.json with mcp-framework',
    hint: 'mcp-server',
    sql: `
      SELECT DISTINCT repo_name
      FROM \`bigquery-public-data.github_repos.contents\`
      WHERE path = 'package.json'
        AND content LIKE '%mcp-framework%'
    `,
    bytesEstimate: '200 GB',
  },

  // ── Content-based: Python MCP servers ──
  {
    name: 'setup.py/pyproject.toml with mcp SDK',
    hint: 'mcp-server',
    sql: `
      SELECT DISTINCT repo_name
      FROM \`bigquery-public-data.github_repos.contents\`
      WHERE (path = 'setup.py' OR path = 'pyproject.toml' OR path = 'setup.cfg')
        AND (content LIKE '%mcp-server%' OR content LIKE '%modelcontextprotocol%' OR content LIKE '%mcp_server%')
    `,
    bytesEstimate: '100 GB',
  },

  // ── n8n community nodes (package.json with n8n node pattern) ──
  {
    name: 'package.json with n8n-community-node',
    hint: 'n8n-node',
    sql: `
      SELECT DISTINCT repo_name
      FROM \`bigquery-public-data.github_repos.contents\`
      WHERE path = 'package.json'
        AND (content LIKE '%n8n-community-node-package%' OR content LIKE '%n8n-nodes-%')
    `,
    bytesEstimate: '200 GB',
  },

  // ── LangChain tools ──
  {
    name: 'Python files importing langchain tools',
    hint: 'langchain-tool',
    sql: `
      SELECT DISTINCT repo_name
      FROM \`bigquery-public-data.github_repos.contents\`
      WHERE (path = 'setup.py' OR path = 'pyproject.toml')
        AND (content LIKE '%langchain-community%' OR content LIKE '%langchain_community%')
    `,
    bytesEstimate: '100 GB',
  },

  // ── CrewAI tools ──
  {
    name: 'Python projects with crewai dependency',
    hint: 'crewai-tool',
    sql: `
      SELECT DISTINCT repo_name
      FROM \`bigquery-public-data.github_repos.contents\`
      WHERE (path = 'setup.py' OR path = 'pyproject.toml' OR path = 'requirements.txt')
        AND content LIKE '%crewai%'
    `,
    bytesEstimate: '100 GB',
  },
];

async function runBigQueryDiscovery(bq) {
  log('🔍', '\n═══ BIGQUERY DISCOVERY ═══\n');

  const allRepos = new Map();  // repo_name → type_hint

  for (const query of BQ_QUERIES) {
    if (timeExpired()) {
      log('⏰', 'Time budget expired, stopping BigQuery queries');
      break;
    }

    log('📋', `Running: ${query.name} (est. ${query.bytesEstimate})`);

    try {
      // Dry run first to check cost
      const [dryJob] = await bq.createQueryJob({
        query: query.sql,
        location: 'US',
        dryRun: true,
      });
      const bytesProcessed = parseInt(dryJob.metadata.statistics.totalBytesProcessed || '0');
      const gbProcessed = (bytesProcessed / 1e9).toFixed(1);
      log('  ', `Dry run: ${gbProcessed} GB will be scanned`);

      // Skip if over 300GB to stay in free tier
      if (bytesProcessed > 300e9) {
        log('⚠️', `Skipping — ${gbProcessed} GB exceeds safety limit (300 GB). Use contents queries sparingly.`);
        continue;
      }

      // Actually run
      const [rows] = await bq.query({
        query: query.sql,
        location: 'US',
      });

      log('  ', `→ ${rows.length} repos found`);

      for (const row of rows) {
        const repoName = row.repo_name;
        if (repoName && !allRepos.has(repoName)) {
          allRepos.set(repoName, query.hint);
        }
      }
    } catch (err) {
      log('❌', `Query failed: ${err.message.substring(0, 150)}`);
    }

    await sleep(1000);
  }

  log('📊', `BigQuery discovery: ${allRepos.size} unique repos found`);
  return allRepos;
}

// ─────────────────────── GitHub Metadata ─────────────────────────

/**
 * Hydrate repo metadata from GitHub API.
 * Only fetches for repos NOT already in raw_repos.
 */
async function hydrateFromGitHub(repoName) {
  if (!ENV.GITHUB_PAT) return null;

  const headers = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'OneSkill-Scraper/4.0',
    Authorization: `token ${ENV.GITHUB_PAT}`,
  };

  try {
    const res = await fetch(`https://api.github.com/repos/${repoName}`, { headers });

    // Rate limit handling
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining !== null && parseInt(remaining, 10) < 5) {
      const reset = parseInt(res.headers.get('x-ratelimit-reset') || '0', 10) * 1000;
      const wait = Math.max(0, reset - Date.now()) + 2000;
      log('⏳', `Rate limit low (${remaining} left) — sleeping ${(wait / 1000).toFixed(0)}s`);
      await sleep(wait);
    }

    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

// ─────────────────────── Main Pipeline ──────────────────────────

async function main() {
  const startTime = Date.now();
  validateEnv();

  const bq = createBigQueryClient();

  // Step 1: BigQuery discovery — get ALL matching repo names
  const discovered = await runBigQueryDiscovery(bq);

  if (discovered.size === 0) {
    log('✅', 'No new repos discovered');
    return;
  }

  // Step 2: Filter out repos already in raw_repos
  log('🔍', `Checking which of ${discovered.size} repos are already indexed...`);

  const existingSet = new Set();
  const PAGE = 1000;
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    try {
      const rows = await sbGet('raw_repos', `select=github_full_name&limit=${PAGE}&offset=${offset}`);
      for (const r of rows) existingSet.add(r.github_full_name);
      hasMore = rows.length === PAGE;
      offset += PAGE;
    } catch {
      hasMore = false;
    }
  }

  const newRepos = [];
  for (const [repoName, hint] of discovered) {
    if (!existingSet.has(repoName)) {
      newRepos.push({ repoName, hint });
    }
  }

  log('📊', `${discovered.size} discovered, ${existingSet.size} already indexed, ${newRepos.length} new`);

  if (newRepos.length === 0) {
    log('✅', 'All discovered repos are already indexed');
    return;
  }

  // Step 3: Hydrate metadata from GitHub API + save to raw_repos
  log('🔄', `Hydrating metadata for ${newRepos.length} new repos...`);

  let saved = 0;
  let noMetadata = 0;
  const HYDRATE_BATCH = 10;

  for (let i = 0; i < newRepos.length && !timeExpired(); i += HYDRATE_BATCH) {
    const batch = newRepos.slice(i, i + HYDRATE_BATCH);

    const rows = [];
    for (const { repoName, hint } of batch) {
      const repo = await hydrateFromGitHub(repoName);
      await sleep(200);  // ~5 req/s to stay safe on rate limits

      if (repo) {
        rows.push({
          github_full_name:  repo.full_name,
          owner_login:       repo.owner?.login || repoName.split('/')[0],
          repo_name:         repo.name,
          description:       (repo.description || '').substring(0, 500),
          language:          repo.language || null,
          stars:             repo.stargazers_count || 0,
          forks:             repo.forks_count || 0,
          open_issues:       repo.open_issues_count || 0,
          license:           repo.license?.spdx_id || null,
          default_branch:    repo.default_branch || 'main',
          topics:            JSON.stringify(repo.topics || []),
          github_url:        repo.html_url,
          owner_avatar_url:  repo.owner?.avatar_url,
          owner_html_url:    repo.owner?.html_url,
          github_created_at: repo.created_at,
          github_updated_at: repo.updated_at,
          readme_raw:        null,  // fetched lazily during enrich
          type_hint:         hint,
          source:            'bigquery',
          updated_at:        new Date().toISOString(),
        });
      } else {
        // Save without metadata — enrich will still work with just repo name
        noMetadata++;
        const [owner, name] = repoName.split('/');
        rows.push({
          github_full_name:  repoName,
          owner_login:       owner || 'unknown',
          repo_name:         name || repoName,
          description:       null,
          language:          null,
          stars:             0,
          forks:             0,
          open_issues:       0,
          license:           null,
          default_branch:    'main',
          topics:            '[]',
          github_url:        `https://github.com/${repoName}`,
          owner_avatar_url:  null,
          owner_html_url:    null,
          github_created_at: null,
          github_updated_at: null,
          readme_raw:        null,
          type_hint:         hint,
          source:            'bigquery',
          updated_at:        new Date().toISOString(),
        });
      }
    }

    // Batch upsert to raw_repos
    for (let start = 0; start < rows.length; start += BATCH_SIZE) {
      const chunk = rows.slice(start, start + BATCH_SIZE);
      try {
        const result = await sbUpsert('raw_repos', chunk, 'github_full_name');
        saved += result.length;
      } catch (err) {
        log('⚠️', `Batch error: ${err.message.substring(0, 100)}`);
        for (const row of chunk) {
          try { await sbUpsert('raw_repos', [row], 'github_full_name'); saved++; }
          catch { /* skip */ }
        }
      }
    }

    const pct = Math.round(((i + batch.length) / newRepos.length) * 100);
    log('💾', `Progress: ${saved} saved, ${noMetadata} without metadata (${pct}%)`);
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  log('🏁', `BigQuery scraper complete: ${saved} new repos saved (${noMetadata} without metadata) in ${elapsed} min`);
}

main().catch((err) => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
