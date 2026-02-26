#!/usr/bin/env node

/**
 * OneSkill Registry Scraper — npm + PyPI + Awesome Lists
 *
 * Supplements the GitHub Search scraper with package-registry data sources.
 * These have NO GitHub API cost — they use npm/PyPI registries directly
 * and raw.githubusercontent.com for awesome-list parsing.
 *
 * Modes:
 *   --npm           : Search npm for MCP/AI packages → raw_repos
 *   --pypi          : Search PyPI for MCP/AI packages → raw_repos
 *   --awesome       : Parse curated awesome-lists → raw_repos
 *   --all           : Run all sources (default)
 *
 *   --time-budget M : Gracefully stop after M minutes
 */

// ─────────────────────────── CLI flags ───────────────────────────

const FLAGS = {
  npm:     process.argv.includes('--npm'),
  pypi:    process.argv.includes('--pypi'),
  awesome: process.argv.includes('--awesome'),
};
const RUN_ALL = !FLAGS.npm && !FLAGS.pypi && !FLAGS.awesome;

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

// ─────────────────────────── npm Scraper ─────────────────────────

/**
 * npm search keywords mapped to artifact types.
 * Each yields 250 results max per query, but we paginate.
 */
const NPM_QUERIES = [
  // MCP servers
  { keywords: 'mcp server', hint: 'mcp-server' },
  { keywords: 'mcp-server', hint: 'mcp-server' },
  { keywords: 'model context protocol', hint: 'mcp-server' },
  { keywords: '@modelcontextprotocol', hint: 'mcp-server' },
  { keywords: 'mcp tool', hint: 'mcp-server' },
  { keywords: 'mcp plugin', hint: 'mcp-server' },
  { keywords: 'mcp integration', hint: 'mcp-server' },

  // n8n nodes
  { keywords: 'n8n-nodes', hint: 'n8n-node' },
  { keywords: 'n8n community node', hint: 'n8n-node' },
  { keywords: 'n8n-community-node-package', hint: 'n8n-node' },

  // LangChain
  { keywords: 'langchain tool', hint: 'langchain-tool' },
  { keywords: '@langchain', hint: 'langchain-tool' },
  { keywords: 'langchain integration', hint: 'langchain-tool' },

  // Skills
  { keywords: 'claude-code skill', hint: 'skill' },
  { keywords: 'agent-skills', hint: 'skill' },
  { keywords: 'ai agent tool', hint: 'skill' },

  // CrewAI (npm packages)
  { keywords: 'crewai', hint: 'crewai-tool' },

  // AI Workflows
  { keywords: 'ai workflow agent', hint: 'workflow' },
  { keywords: 'agentic workflow', hint: 'workflow' },
];

async function searchNpm(keywords, maxResults = 2000) {
  const packages = [];
  let offset = 0;
  const pageSize = 250;

  while (offset < maxResults && !timeExpired()) {
    try {
      const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(keywords)}&size=${pageSize}&from=${offset}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'OneSkill-Scraper/4.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) {
        log('⚠️', `npm search ${res.status} for "${keywords}" at offset ${offset}`);
        break;
      }
      const data = await res.json();
      if (!data.objects || data.objects.length === 0) break;

      packages.push(...data.objects);
      if (data.objects.length < pageSize) break;
      offset += pageSize;
      await sleep(300);
    } catch (err) {
      log('⚠️', `npm error: ${err.message.substring(0, 80)}`);
      await sleep(2000);
      break;
    }
  }
  return packages;
}

function npmPkgToRawRow(pkg, hint) {
  const p = pkg.package;
  const ghUrl = extractGithubUrl(p.links?.repository || p.links?.homepage || '');
  const fullName = ghUrl ? ghUrl.replace('https://github.com/', '') : `npm:${p.name}`;

  return {
    github_full_name:  fullName,
    owner_login:       p.publisher?.username || p.author?.name || fullName.split('/')[0] || 'unknown',
    repo_name:         p.name,
    description:       (p.description || '').substring(0, 500),
    language:          'JavaScript',
    stars:             0,  // npm doesn't have stars; will be updated if GitHub repo found
    forks:             0,
    open_issues:       0,
    license:           null,
    default_branch:    'main',
    topics:            JSON.stringify(p.keywords || []),
    github_url:        ghUrl || `https://www.npmjs.com/package/${p.name}`,
    owner_avatar_url:  null,
    owner_html_url:    null,
    github_created_at: p.date || new Date().toISOString(),
    github_updated_at: p.date || new Date().toISOString(),
    readme_raw:        null,
    type_hint:         hint,
    source:            'npm',
    updated_at:        new Date().toISOString(),
  };
}

function extractGithubUrl(url) {
  if (!url) return null;
  const m = url.match(/github\.com\/([^/]+\/[^/\s#?]+)/i);
  if (m) return `https://github.com/${m[1].replace(/\.git$/, '')}`;
  return null;
}

async function runNpmScraper() {
  log('📦', '\n═══ NPM REGISTRY SCRAPER ═══\n');
  const seen = new Set();
  let totalSaved = 0;

  // Load existing github_full_names to skip duplicates
  try {
    const existing = await sbGet('raw_repos', 'select=github_full_name&source=eq.npm&limit=50000');
    for (const row of existing) seen.add(row.github_full_name);
    log('📋', `${seen.size} existing npm entries in raw_repos`);
  } catch { /* fresh start */ }

  for (const { keywords, hint } of NPM_QUERIES) {
    if (timeExpired()) break;
    log('🔎', `Searching npm: "${keywords}" [${hint}]`);
    const packages = await searchNpm(keywords);
    log('  ', `→ ${packages.length} results`);

    const rows = [];
    for (const pkg of packages) {
      const row = npmPkgToRawRow(pkg, hint);
      if (!seen.has(row.github_full_name)) {
        seen.add(row.github_full_name);
        rows.push(row);
      }
    }

    // Batch upsert
    for (let start = 0; start < rows.length; start += BATCH_SIZE) {
      const chunk = rows.slice(start, start + BATCH_SIZE);
      try {
        const result = await sbUpsert('raw_repos', chunk, 'github_full_name');
        totalSaved += result.length;
      } catch (err) {
        log('⚠️', `npm batch error: ${err.message.substring(0, 100)}`);
        // One-by-one fallback
        for (const row of chunk) {
          try {
            await sbUpsert('raw_repos', [row], 'github_full_name');
            totalSaved++;
          } catch { /* skip */ }
        }
      }
    }
    log('💾', `Saved ${rows.length} new from "${keywords}" (${totalSaved} total)`);
  }

  log('📊', `npm scraper complete: ${totalSaved} new repos saved`);
  return totalSaved;
}

// ─────────────────────────── PyPI Scraper ────────────────────────

/**
 * PyPI search queries. PyPI's JSON search is limited, so we use
 * the XML-RPC search API and the Simple API for listing.
 */
const PYPI_QUERIES = [
  // MCP servers
  { keywords: 'mcp server', hint: 'mcp-server' },
  { keywords: 'mcp-server', hint: 'mcp-server' },
  { keywords: 'model context protocol', hint: 'mcp-server' },
  { keywords: 'mcp tool', hint: 'mcp-server' },

  // LangChain
  { keywords: 'langchain tool', hint: 'langchain-tool' },
  { keywords: 'langchain integration', hint: 'langchain-tool' },

  // CrewAI
  { keywords: 'crewai tool', hint: 'crewai-tool' },
  { keywords: 'crewai', hint: 'crewai-tool' },

  // AI Workflows
  { keywords: 'ai agent tool', hint: 'workflow' },
  { keywords: 'ai workflow', hint: 'workflow' },
  { keywords: 'autogen', hint: 'workflow' },

  // Skills
  { keywords: 'claude code', hint: 'skill' },
  { keywords: 'agent skills', hint: 'skill' },
];

/**
 * Search PyPI using the warehouse search endpoint (HTML scraping).
 * PyPI deprecated XML-RPC search, so we use the web search.
 */
async function searchPyPI(keywords, maxPages = 10) {
  const packages = [];

  for (let page = 1; page <= maxPages && !timeExpired(); page++) {
    try {
      const url = `https://pypi.org/search/?q=${encodeURIComponent(keywords)}&page=${page}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'OneSkill-Scraper/4.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) break;
      const html = await res.text();

      // Extract package names from search results HTML
      const regex = /<a class="package-snippet"[^>]*href="\/project\/([^/"]+)\/?"/g;
      let match;
      let found = 0;
      while ((match = regex.exec(html)) !== null) {
        packages.push(match[1]);
        found++;
      }
      if (found === 0) break;
      await sleep(1000);  // Be respectful
    } catch (err) {
      log('⚠️', `PyPI search error page ${page}: ${err.message.substring(0, 80)}`);
      break;
    }
  }
  return [...new Set(packages)];
}

async function getPyPIPackageInfo(name) {
  try {
    const res = await fetch(`https://pypi.org/pypi/${name}/json`, {
      headers: { 'User-Agent': 'OneSkill-Scraper/4.0' },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

function pypiPkgToRawRow(info, hint) {
  const i = info.info;
  const ghUrl = extractGithubUrl(
    i.project_urls?.Repository || i.project_urls?.Source ||
    i.project_urls?.Homepage || i.home_page || ''
  );
  const fullName = ghUrl ? ghUrl.replace('https://github.com/', '') : `pypi:${i.name}`;

  return {
    github_full_name:  fullName,
    owner_login:       i.author || fullName.split('/')[0] || 'unknown',
    repo_name:         i.name,
    description:       (i.summary || '').substring(0, 500),
    language:          'Python',
    stars:             0,
    forks:             0,
    open_issues:       0,
    license:           i.license || null,
    default_branch:    'main',
    topics:            JSON.stringify(i.keywords ? i.keywords.split(/[,\s]+/).filter(Boolean) : []),
    github_url:        ghUrl || `https://pypi.org/project/${i.name}/`,
    owner_avatar_url:  null,
    owner_html_url:    i.author_email ? `mailto:${i.author_email}` : null,
    github_created_at: null,
    github_updated_at: null,
    readme_raw:        (i.description || '').substring(0, 50000),
    type_hint:         hint,
    source:            'pypi',
    updated_at:        new Date().toISOString(),
  };
}

async function runPyPIScraper() {
  log('🐍', '\n═══ PYPI REGISTRY SCRAPER ═══\n');
  const seen = new Set();
  let totalSaved = 0;

  // Load existing
  try {
    const existing = await sbGet('raw_repos', 'select=github_full_name&source=eq.pypi&limit=50000');
    for (const row of existing) seen.add(row.github_full_name);
    log('📋', `${seen.size} existing PyPI entries in raw_repos`);
  } catch { /* fresh start */ }

  for (const { keywords, hint } of PYPI_QUERIES) {
    if (timeExpired()) break;
    log('🔎', `Searching PyPI: "${keywords}" [${hint}]`);
    const packageNames = await searchPyPI(keywords);
    log('  ', `→ ${packageNames.length} packages found`);

    // Fetch details in batches of 10
    const CONCURRENCY = 10;
    for (let i = 0; i < packageNames.length && !timeExpired(); i += CONCURRENCY) {
      const slice = packageNames.slice(i, i + CONCURRENCY);
      const infos = await Promise.all(slice.map(name => getPyPIPackageInfo(name)));

      const rows = [];
      for (const info of infos) {
        if (!info) continue;
        const row = pypiPkgToRawRow(info, hint);
        if (!seen.has(row.github_full_name)) {
          seen.add(row.github_full_name);
          rows.push(row);
        }
      }

      if (rows.length > 0) {
        try {
          const result = await sbUpsert('raw_repos', rows, 'github_full_name');
          totalSaved += result.length;
        } catch (err) {
          for (const row of rows) {
            try { await sbUpsert('raw_repos', [row], 'github_full_name'); totalSaved++; }
            catch { /* skip */ }
          }
        }
      }
      await sleep(500);
    }
    log('💾', `Saved from "${keywords}" (${totalSaved} total)`);
  }

  log('📊', `PyPI scraper complete: ${totalSaved} new repos saved`);
  return totalSaved;
}

// ─────────────────────────── Awesome Lists ───────────────────────

/**
 * Curated awesome-lists to parse. Each contains manually reviewed,
 * high-quality repos. We parse the markdown to extract GitHub links.
 */
const AWESOME_LISTS = [
  // MCP servers
  { owner: 'punkpeye', repo: 'awesome-mcp-servers', hint: 'mcp-server' },
  { owner: 'wong2', repo: 'awesome-mcp-servers', hint: 'mcp-server' },
  { owner: 'appcypher', repo: 'awesome-mcp-servers', hint: 'mcp-server' },
  { owner: 'modelcontextprotocol', repo: 'servers', hint: 'mcp-server' },
  { owner: 'anthropics', repo: 'awesome-mcp', hint: 'mcp-server' },

  // Cursor rules
  { owner: 'PatrickJS', repo: 'awesome-cursorrules', hint: 'cursor-rules' },
  { owner: 'pontusab', repo: 'cursor.directory', hint: 'cursor-rules' },

  // n8n
  { owner: 'jmgb-digital', repo: 'awesome-n8n', hint: 'n8n-node' },

  // LangChain
  { owner: 'kyrolabs', repo: 'awesome-langchain', hint: 'langchain-tool' },

  // CrewAI
  { owner: 'crewAIInc', repo: 'awesome-crewai', hint: 'crewai-tool' },

  // AI agents / workflows
  { owner: 'e2b-dev', repo: 'awesome-ai-agents', hint: 'workflow' },
  { owner: 'Jenqyang', repo: 'Awesome-AI-Agents', hint: 'workflow' },
  { owner: 'kyrolabs', repo: 'awesome-ai-tools', hint: 'skill' },

  // Claude Code skills
  { owner: 'anthropics', repo: 'claude-code-skills', hint: 'skill' },
];

async function fetchRawFile(owner, repo, path = 'README.md') {
  for (const branch of ['main', 'master']) {
    try {
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'OneSkill-Scraper/4.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return res.text();
    } catch { /* try next */ }
  }
  return null;
}

function extractGithubLinks(markdown) {
  // Match [text](https://github.com/owner/repo) patterns
  const regex = /\[([^\]]*)\]\(https?:\/\/github\.com\/([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)\/?[^)]*\)/g;
  const links = [];
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const [, title, fullName] = match;
    // Skip non-repo links (e.g., issues, pulls, wiki, blob)
    if (fullName.includes('/issues') || fullName.includes('/pull') ||
        fullName.includes('/wiki') || fullName.includes('/blob')) continue;
    links.push({ title: title.trim(), fullName: fullName.replace(/\.git$/, '') });
  }
  return links;
}

async function runAwesomeListScraper() {
  log('⭐', '\n═══ AWESOME LIST SCRAPER ═══\n');
  const seen = new Set();
  let totalSaved = 0;

  for (const list of AWESOME_LISTS) {
    if (timeExpired()) break;
    log('📋', `Parsing ${list.owner}/${list.repo} [${list.hint}]`);

    const readme = await fetchRawFile(list.owner, list.repo);
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

    // Batch upsert
    for (let start = 0; start < rows.length; start += BATCH_SIZE) {
      const chunk = rows.slice(start, start + BATCH_SIZE);
      try {
        const result = await sbUpsert('raw_repos', chunk, 'github_full_name');
        totalSaved += result.length;
      } catch (err) {
        for (const row of chunk) {
          try { await sbUpsert('raw_repos', [row], 'github_full_name'); totalSaved++; }
          catch { /* skip */ }
        }
      }
    }
    log('💾', `Saved ${rows.length} new from ${list.owner}/${list.repo} (${totalSaved} total)`);
    await sleep(500);
  }

  log('📊', `Awesome list scraper complete: ${totalSaved} new repos saved`);
  return totalSaved;
}

// ─────────────────────────── Entry Point ─────────────────────────

async function main() {
  const startTime = Date.now();
  validateEnv();

  let total = 0;

  if (FLAGS.npm || RUN_ALL) {
    total += await runNpmScraper();
  }
  if (FLAGS.pypi || RUN_ALL) {
    total += await runPyPIScraper();
  }
  if (FLAGS.awesome || RUN_ALL) {
    total += await runAwesomeListScraper();
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  log('⏱️', `Registry scraper complete: ${total} total new repos in ${elapsed} min`);
}

main().catch((err) => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
