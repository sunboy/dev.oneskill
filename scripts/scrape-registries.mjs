#!/usr/bin/env node

/**
 * OneSkill Registry Aggregator — Pull from existing MCP directories
 *
 * Instead of discovering everything from scratch via GitHub Search API,
 * we aggregate from directories that have already done the hard work:
 *
 * 1. Official MCP Registry (registry.modelcontextprotocol.io) — Anthropic-backed, verified
 * 2. PulseMCP API (pulsemcp.com/api) — 8,600+ servers, enriched metadata
 * 3. Awesome-lists on GitHub — curated by community
 *
 * All APIs are unauthenticated. No GitHub PAT or special tokens needed.
 * This can discover thousands of MCP servers in minutes with zero rate limit issues.
 *
 * Usage:
 *   node scripts/scrape-registries.mjs [--time-budget M]
 *   node scripts/scrape-registries.mjs --official    # Official registry only
 *   node scripts/scrape-registries.mjs --pulsemcp    # PulseMCP only
 *   node scripts/scrape-registries.mjs --awesome     # Awesome lists only
 */

// ─────────────────────────── CLI flags ───────────────────────────

const FLAGS = {
  official: process.argv.includes('--official'),
  pulsemcp: process.argv.includes('--pulsemcp'),
  awesome:  process.argv.includes('--awesome'),
};
const RUN_ALL = !FLAGS.official && !FLAGS.pulsemcp && !FLAGS.awesome;

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
};

function validateEnv() {
  const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter(k => !ENV[k]);
  if (missing.length) { console.error(`Missing: ${missing.join(', ')}`); process.exit(1); }
}

// ─────────────────────────── Supabase ────────────────────────────

const sbHeaders = () => ({
  'Content-Type':  'application/json',
  Authorization:   `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`,
  apikey:          ENV.SUPABASE_SERVICE_ROLE_KEY,
});

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

async function sbGet(table, query = '') {
  const res = await fetch(`${ENV.SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`Supabase GET ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

function extractGithubFullName(url) {
  if (!url) return null;
  const m = url.match(/github\.com\/([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)/i);
  if (m) return m[1].replace(/\.git$/, '');
  return null;
}

async function saveRows(rows, source) {
  let saved = 0;
  for (let start = 0; start < rows.length; start += BATCH_SIZE) {
    const chunk = rows.slice(start, start + BATCH_SIZE);
    try {
      const result = await sbUpsert('raw_repos', chunk, 'github_full_name');
      saved += result.length;
    } catch (err) {
      log('⚠️', `${source} batch error: ${err.message.substring(0, 120)}`);
      for (const row of chunk) {
        try { await sbUpsert('raw_repos', [row], 'github_full_name'); saved++; }
        catch { /* skip */ }
      }
    }
  }
  return saved;
}

// ═══════════════════════════════════════════════════════════════════
// SOURCE 1: Official MCP Registry (registry.modelcontextprotocol.io)
// ═══════════════════════════════════════════════════════════════════

async function scrapeOfficialRegistry() {
  log('🏛️', '\n═══ OFFICIAL MCP REGISTRY ═══\n');

  const BASE = 'https://registry.modelcontextprotocol.io/v0.1/servers';
  const servers = [];
  let cursor = null;
  let page = 0;

  while (!timeExpired()) {
    const url = cursor
      ? `${BASE}?limit=100&cursor=${encodeURIComponent(cursor)}`
      : `${BASE}?limit=100`;

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'OneSkill-Scraper/4.0', Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        log('⚠️', `Official registry ${res.status}: ${(await res.text()).substring(0, 100)}`);
        break;
      }

      const data = await res.json();

      // The API returns { servers: [...], next_cursor: "..." }
      const items = data.servers || data.items || data;
      if (!Array.isArray(items) || items.length === 0) break;

      servers.push(...items);
      page++;
      log('📋', `Page ${page}: ${items.length} servers (${servers.length} total)`);

      cursor = data.next_cursor || data.nextCursor || null;
      if (!cursor) break;

      await sleep(500);
    } catch (err) {
      log('⚠️', `Registry fetch error: ${err.message.substring(0, 100)}`);
      break;
    }
  }

  log('📊', `Fetched ${servers.length} servers from official registry`);

  // Convert to raw_repos rows
  const rows = [];
  for (const server of servers) {
    const ghUrl = server.repository?.url || server.source_url || server.url || '';
    const fullName = extractGithubFullName(ghUrl);
    if (!fullName) continue;  // Skip servers without a GitHub repo

    const [owner, repoName] = fullName.split('/');
    rows.push({
      github_full_name:  fullName,
      owner_login:       owner,
      repo_name:         repoName || server.name || fullName,
      description:       (server.description || server.short_description || '').substring(0, 500),
      language:          null,
      stars:             0,
      forks:             0,
      open_issues:       0,
      license:           server.license || null,
      default_branch:    'main',
      topics:            JSON.stringify(server.tags || server.categories || []),
      github_url:        `https://github.com/${fullName}`,
      owner_avatar_url:  null,
      owner_html_url:    `https://github.com/${owner}`,
      github_created_at: server.created_at || null,
      github_updated_at: server.updated_at || null,
      readme_raw:        null,
      type_hint:         'mcp-server',
      source:            'official-registry',
      updated_at:        new Date().toISOString(),
    });
  }

  const saved = await saveRows(rows, 'official-registry');
  log('💾', `Official registry: ${saved} repos saved (${servers.length} fetched, ${rows.length} with GitHub repos)`);
  return saved;
}

// ═══════════════════════════════════════════════════════════════════
// SOURCE 2: PulseMCP API (pulsemcp.com/api)
// ═══════════════════════════════════════════════════════════════════

async function scrapePulseMCP() {
  log('💜', '\n═══ PULSEMCP DIRECTORY ═══\n');

  // PulseMCP has a list endpoint — try paginated fetch
  const servers = [];
  let offset = 0;
  const limit = 100;

  while (!timeExpired()) {
    try {
      // Try the known API endpoints
      const url = `https://api.pulsemcp.com/v0beta1/servers?limit=${limit}&offset=${offset}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'OneSkill-Scraper/4.0', Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        // Try alternative endpoint format
        if (offset === 0) {
          log('⚠️', `PulseMCP API ${res.status}, trying alternative endpoint...`);
          const altServers = await scrapePulseMCPAlternative();
          servers.push(...altServers);
        }
        break;
      }

      const data = await res.json();
      const items = data.servers || data.items || data.results || data;
      if (!Array.isArray(items) || items.length === 0) break;

      servers.push(...items);
      log('📋', `Offset ${offset}: ${items.length} servers (${servers.length} total)`);

      if (items.length < limit) break;
      offset += limit;
      await sleep(500);
    } catch (err) {
      log('⚠️', `PulseMCP error: ${err.message.substring(0, 100)}`);
      if (offset === 0) {
        const altServers = await scrapePulseMCPAlternative();
        servers.push(...altServers);
      }
      break;
    }
  }

  log('📊', `Fetched ${servers.length} servers from PulseMCP`);

  const rows = [];
  for (const server of servers) {
    const ghUrl = server.source_url || server.github_url || server.repository_url ||
                  server.repo_url || server.url || '';
    const fullName = extractGithubFullName(ghUrl);
    if (!fullName) continue;

    const [owner, repoName] = fullName.split('/');
    rows.push({
      github_full_name:  fullName,
      owner_login:       owner,
      repo_name:         repoName || server.name || fullName,
      description:       (server.description || server.short_description || '').substring(0, 500),
      language:          server.language || null,
      stars:             server.github_stars || server.stars || 0,
      forks:             0,
      open_issues:       0,
      license:           server.license || null,
      default_branch:    'main',
      topics:            JSON.stringify(server.tags || server.categories || []),
      github_url:        `https://github.com/${fullName}`,
      owner_avatar_url:  server.owner_avatar || null,
      owner_html_url:    `https://github.com/${owner}`,
      github_created_at: server.created_at || null,
      github_updated_at: server.updated_at || null,
      readme_raw:        null,
      type_hint:         'mcp-server',
      source:            'pulsemcp',
      updated_at:        new Date().toISOString(),
    });
  }

  const saved = await saveRows(rows, 'pulsemcp');
  log('💾', `PulseMCP: ${saved} repos saved (${servers.length} fetched, ${rows.length} with GitHub repos)`);
  return saved;
}

/**
 * Alternative PulseMCP fetching via their search endpoint
 */
async function scrapePulseMCPAlternative() {
  const servers = [];
  const categories = [
    'data', 'developer-tools', 'productivity', 'search', 'ai',
    'communication', 'finance', 'security', 'cloud', 'database',
    'devops', 'automation', 'analytics', 'storage', 'monitoring',
  ];

  for (const cat of categories) {
    if (timeExpired()) break;
    try {
      const url = `https://api.pulsemcp.com/v0beta1/servers?category=${cat}&limit=100`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'OneSkill-Scraper/4.0', Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const items = data.servers || data.items || data.results || data;
      if (Array.isArray(items)) {
        servers.push(...items);
        log('  ', `Category "${cat}": ${items.length} servers`);
      }
      await sleep(500);
    } catch { /* try next category */ }
  }
  return servers;
}

// ═══════════════════════════════════════════════════════════════════
// SOURCE 3: Awesome Lists on GitHub
// ═══════════════════════════════════════════════════════════════════

const AWESOME_LISTS = [
  // MCP servers
  { owner: 'punkpeye', repo: 'awesome-mcp-servers', hint: 'mcp-server' },
  { owner: 'wong2', repo: 'awesome-mcp-servers', hint: 'mcp-server' },
  { owner: 'appcypher', repo: 'awesome-mcp-servers', hint: 'mcp-server' },
  { owner: 'modelcontextprotocol', repo: 'servers', hint: 'mcp-server' },

  // Cursor rules
  { owner: 'PatrickJS', repo: 'awesome-cursorrules', hint: 'cursor-rules' },

  // n8n
  { owner: 'jmgb-digital', repo: 'awesome-n8n', hint: 'n8n-node' },

  // LangChain
  { owner: 'kyrolabs', repo: 'awesome-langchain', hint: 'langchain-tool' },

  // AI agents / workflows
  { owner: 'e2b-dev', repo: 'awesome-ai-agents', hint: 'workflow' },
  { owner: 'Jenqyang', repo: 'Awesome-AI-Agents', hint: 'workflow' },
];

function extractGithubLinks(markdown) {
  const regex = /\[([^\]]*)\]\(https?:\/\/github\.com\/([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)\/?[^)]*\)/g;
  const links = [];
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const [, title, fullName] = match;
    if (fullName.includes('/issues') || fullName.includes('/pull') ||
        fullName.includes('/wiki') || fullName.includes('/blob') ||
        fullName.includes('/tree')) continue;
    links.push({ title: title.trim(), fullName: fullName.replace(/\.git$/, '') });
  }
  return links;
}

async function scrapeAwesomeLists() {
  log('⭐', '\n═══ AWESOME LIST SCRAPER ═══\n');
  const seen = new Set();
  let totalSaved = 0;

  for (const list of AWESOME_LISTS) {
    if (timeExpired()) break;
    log('📋', `Parsing ${list.owner}/${list.repo} [${list.hint}]`);

    let readme = null;
    for (const branch of ['main', 'master']) {
      for (const file of ['README.md', 'readme.md']) {
        try {
          const url = `https://raw.githubusercontent.com/${list.owner}/${list.repo}/${branch}/${file}`;
          const res = await fetch(url, {
            headers: { 'User-Agent': 'OneSkill-Scraper/4.0' },
            signal: AbortSignal.timeout(15000),
          });
          if (res.ok) { readme = await res.text(); break; }
        } catch { /* try next */ }
      }
      if (readme) break;
    }

    if (!readme) {
      log('⚠️', `  Could not fetch README — skipping`);
      continue;
    }

    const links = extractGithubLinks(readme);
    log('  ', `→ ${links.length} GitHub links found`);

    const rows = [];
    for (const { title, fullName } of links) {
      if (seen.has(fullName)) continue;
      seen.add(fullName);

      const [owner, repoName] = fullName.split('/');
      if (!owner || !repoName) continue;

      rows.push({
        github_full_name:  fullName,
        owner_login:       owner,
        repo_name:         repoName,
        description:       title.substring(0, 500),
        language:          null,
        stars:             0,
        forks:             0,
        open_issues:       0,
        license:           null,
        default_branch:    'main',
        topics:            '[]',
        github_url:        `https://github.com/${fullName}`,
        owner_avatar_url:  null,
        owner_html_url:    `https://github.com/${owner}`,
        github_created_at: null,
        github_updated_at: null,
        readme_raw:        null,
        type_hint:         list.hint,
        source:            'awesome-list',
        updated_at:        new Date().toISOString(),
      });
    }

    const saved = await saveRows(rows, 'awesome-list');
    totalSaved += saved;
    log('💾', `Saved ${saved} from ${list.owner}/${list.repo} (${totalSaved} total)`);
    await sleep(500);
  }

  log('📊', `Awesome list scraper: ${totalSaved} repos saved`);
  return totalSaved;
}

// ─────────────────────────── Entry Point ─────────────────────────

async function main() {
  const startTime = Date.now();
  validateEnv();

  let total = 0;

  if (FLAGS.official || RUN_ALL) {
    total += await scrapeOfficialRegistry();
  }
  if (FLAGS.pulsemcp || RUN_ALL) {
    total += await scrapePulseMCP();
  }
  if (FLAGS.awesome || RUN_ALL) {
    total += await scrapeAwesomeLists();
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  log('🏁', `Registry aggregator complete: ${total} total repos saved in ${elapsed} min`);
}

main().catch((err) => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
