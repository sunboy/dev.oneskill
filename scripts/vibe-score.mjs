#!/usr/bin/env node

/**
 * OneSkill Vibe Score Pipeline
 *
 * Aggregates social signals from free APIs to compute a "vibe score"
 * for every artifact in the database. Runs daily via GitHub Actions.
 *
 * Sources (all free):
 *   1. npm weekly downloads     – hard usage signal
 *   2. PyPI weekly downloads    – hard usage signal
 *   3. Hacker News (Algolia)    – developer buzz
 *   4. Reddit                   – community sentiment
 *   5. Dev.to                   – blog mentions
 *   6. GitHub Discussions        – project-level chatter
 *
 * Gemini is ONLY used for sentiment analysis on artifacts that actually
 * have social mentions — most won't, keeping cost at ~$2-4/month.
 *
 * Cost model:
 *   Signal APIs:  $0 (all free)
 *   Gemini:       ~$2-4/month (sentiment on ~500-1000 artifacts with mentions)
 *   Actions:      Free (public repo)
 *   Total:        ~$3-5/month
 */

// ─────────────────────────── Config ───────────────────────────────────

const GEMINI_MODEL   = 'gemini-2.5-flash';
const GEMINI_URL     = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
const SENTIMENT_BATCH = 30;   // artifacts per Gemini sentiment call
const MENTION_LOOKBACK_DAYS = 30;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function log(emoji, msg) { console.log(`${emoji}  ${msg}`); }

// ─────────────────────────── Environment ──────────────────────────────

const ENV = {
  SUPABASE_URL:              process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  GITHUB_PAT:                process.env.GITHUB_PAT || process.env.GITHUB_TOKEN,
  GEMINI_API_KEY:            process.env.GEMINI_API_KEY,
  REDDIT_CLIENT_ID:          process.env.REDDIT_CLIENT_ID || '',
  REDDIT_CLIENT_SECRET:      process.env.REDDIT_CLIENT_SECRET || '',
};

function validateEnv() {
  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
  const missing = required.filter(k => !ENV[k]);
  if (missing.length) { console.error(`Missing: ${missing.join(', ')}`); process.exit(1); }
  const optional = [];
  if (!ENV.GEMINI_API_KEY) optional.push('GEMINI_API_KEY (no sentiment analysis)');
  if (!ENV.REDDIT_CLIENT_ID) optional.push('REDDIT_CLIENT_ID (no Reddit signals)');
  if (optional.length) log('⚠️', `Optional missing: ${optional.join(', ')}`);
  log('✅', 'Vibe score pipeline starting');
}

// ─────────────────────────── Supabase ─────────────────────────────────

const sbHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`,
  apikey: ENV.SUPABASE_SERVICE_ROLE_KEY,
});

async function sbGet(table, query = '') {
  const res = await fetch(`${ENV.SUPABASE_URL}/rest/v1/${table}?${query}`, { headers: sbHeaders() });
  if (!res.ok) throw new Error(`SB GET ${table}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function sbUpsert(table, rows, onConflict) {
  const headers = { ...sbHeaders(), Prefer: 'resolution=merge-duplicates,return=representation' };
  const res = await fetch(
    `${ENV.SUPABASE_URL}/rest/v1/${table}${onConflict ? `?on_conflict=${onConflict}` : ''}`,
    { method: 'POST', headers, body: JSON.stringify(rows) },
  );
  if (!res.ok) throw new Error(`SB UPSERT ${table}: ${res.status} ${(await res.text()).substring(0, 200)}`);
  return res.json();
}

async function sbPatch(table, query, body) {
  const headers = { ...sbHeaders(), Prefer: 'return=minimal' };
  const res = await fetch(
    `${ENV.SUPABASE_URL}/rest/v1/${table}?${query}`,
    { method: 'PATCH', headers, body: JSON.stringify(body) },
  );
  if (!res.ok) throw new Error(`SB PATCH ${table}: ${res.status} ${(await res.text()).substring(0, 200)}`);
}

// ─────────────────────────── Load artifacts ───────────────────────────

async function loadArtifacts() {
  // Load in pages of 1000 to avoid hitting Supabase row limits
  let all = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const batch = await sbGet('artifacts',
      `select=id,slug,name,npm_package_name,github_repo_full_name,stars,language` +
      `&status=eq.active&order=stars.desc&limit=${limit}&offset=${offset}`
    );
    all.push(...batch);
    if (batch.length < limit) break;
    offset += limit;
  }
  log('📋', `Loaded ${all.length} active artifacts`);
  return all;
}

// ─────────────────────────── Search term builder ──────────────────────
// Build good search keywords for each artifact

function searchTerms(artifact) {
  const terms = new Set();
  const name = artifact.name;
  const fullName = artifact.github_repo_full_name;

  // The repo name itself
  terms.add(name);

  // npm package name if different from repo name
  if (artifact.npm_package_name && artifact.npm_package_name !== name) {
    terms.add(artifact.npm_package_name);
  }

  // Full name for precise searches
  terms.add(fullName);

  return [...terms].filter(t => t && t.length > 2);
}

// ═══════════════════════════════════════════════════════════════════════
//  SIGNAL SOURCES
// ═══════════════════════════════════════════════════════════════════════

// ─── 1. npm weekly downloads ──────────────────────────────────────────

async function fetchNpmDownloads(packageName) {
  if (!packageName) return 0;
  try {
    const res = await fetch(`https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(packageName)}`);
    if (!res.ok) return 0;
    const data = await res.json();
    return data.downloads || 0;
  } catch { return 0; }
}

async function batchNpmDownloads(artifacts) {
  const results = new Map();
  const npmArtifacts = artifacts.filter(a => a.npm_package_name);
  log('📦', `Fetching npm downloads for ${npmArtifacts.length} packages`);

  // npm scoped-packages API: batch up to 128 packages
  // For simplicity, do individual calls with concurrency control
  const CONCURRENCY = 5;
  for (let i = 0; i < npmArtifacts.length; i += CONCURRENCY) {
    const batch = npmArtifacts.slice(i, i + CONCURRENCY);
    const promises = batch.map(async a => {
      const downloads = await fetchNpmDownloads(a.npm_package_name);
      results.set(a.id, downloads);
    });
    await Promise.all(promises);
    if (i > 0 && i % 100 === 0) log('  ', `npm: ${i}/${npmArtifacts.length}`);
  }

  log('  ', `npm: ${results.size} packages checked`);
  return results;
}

// ─── 2. PyPI weekly downloads ─────────────────────────────────────────

async function fetchPypiDownloads(packageName) {
  if (!packageName) return 0;
  try {
    const res = await fetch(`https://pypistats.org/api/packages/${encodeURIComponent(packageName)}/recent`);
    if (!res.ok) return 0;
    const data = await res.json();
    return data.data?.last_week || 0;
  } catch { return 0; }
}

async function batchPypiDownloads(artifacts) {
  const results = new Map();
  // Only check Python-language artifacts that might have a pip package
  const pyArtifacts = artifacts.filter(a =>
    a.language === 'Python' && a.npm_package_name
  );
  log('🐍', `Fetching PyPI downloads for ${pyArtifacts.length} packages`);

  for (let i = 0; i < pyArtifacts.length; i++) {
    const a = pyArtifacts[i];
    // PyPI package name is often the npm_package_name or repo name
    const pkgName = a.npm_package_name || a.name;
    const downloads = await fetchPypiDownloads(pkgName);
    if (downloads > 0) results.set(a.id, downloads);
    await sleep(200); // Be gentle with PyPI stats
    if (i > 0 && i % 50 === 0) log('  ', `PyPI: ${i}/${pyArtifacts.length}`);
  }

  log('  ', `PyPI: ${results.size} packages with downloads`);
  return results;
}

// ─── 3. Hacker News (Algolia) ─────────────────────────────────────────

async function searchHN(query, lookbackDays = MENTION_LOOKBACK_DAYS) {
  const since = Math.floor((Date.now() - lookbackDays * 86400000) / 1000);
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}` +
    `&tags=(story,show_hn,ask_hn)&numericFilters=created_at_i>${since}&hitsPerPage=5`;
  try {
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return (data.hits || []).map(h => ({
      source: 'hackernews',
      external_id: String(h.objectID),
      title: h.title || '',
      url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`,
      author: h.author || '',
      score: h.points || 0,
      comment_count: h.num_comments || 0,
      snippet: (h.title || '').substring(0, 500),
      mentioned_at: new Date(h.created_at_i * 1000).toISOString(),
    }));
  } catch { return []; }
}

async function batchHNMentions(artifacts) {
  const results = new Map(); // artifactId → mentions[]
  log('🟠', `Searching Hacker News for ${artifacts.length} artifacts`);

  for (let i = 0; i < artifacts.length; i++) {
    const a = artifacts[i];
    const terms = searchTerms(a);
    // Only search the most specific term (full repo name)
    const query = a.github_repo_full_name;
    const hits = await searchHN(query);

    // Also try just the repo name for popular tools
    if (hits.length === 0 && a.stars > 100) {
      const nameHits = await searchHN(a.name);
      // Filter for relevance — name must appear in title
      const relevant = nameHits.filter(h =>
        h.title.toLowerCase().includes(a.name.toLowerCase())
      );
      if (relevant.length > 0) hits.push(...relevant);
      await sleep(200);
    }

    if (hits.length > 0) results.set(a.id, hits);
    await sleep(350); // ~170 req/min, well under HN limits
    if (i > 0 && i % 200 === 0) log('  ', `HN: ${i}/${artifacts.length} (${results.size} with mentions)`);
  }

  log('  ', `HN: ${results.size} artifacts with mentions`);
  return results;
}

// ─── 4. Reddit ────────────────────────────────────────────────────────

let redditToken = null;

async function getRedditToken() {
  if (redditToken) return redditToken;
  if (!ENV.REDDIT_CLIENT_ID || !ENV.REDDIT_CLIENT_SECRET) return null;

  try {
    const res = await fetch('https://www.reddit.com/api/v1/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: 'Basic ' + Buffer.from(`${ENV.REDDIT_CLIENT_ID}:${ENV.REDDIT_CLIENT_SECRET}`).toString('base64'),
        'User-Agent': 'OneSkill-VibeScore/1.0',
      },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) return null;
    const data = await res.json();
    redditToken = data.access_token;
    return redditToken;
  } catch { return null; }
}

const REDDIT_SUBREDDITS = [
  'cursor', 'ClaudeAI', 'ChatGPT', 'LocalLLM', 'n8n', 'langchain',
  'MachineLearning', 'artificial', 'coding', 'webdev', 'node',
];

async function searchReddit(query) {
  const token = await getRedditToken();
  if (!token) return [];

  const subredditStr = REDDIT_SUBREDDITS.join('+');
  const url = `https://oauth.reddit.com/r/${subredditStr}/search?q=${encodeURIComponent(query)}` +
    `&sort=new&limit=5&t=month&restrict_sr=on`;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'User-Agent': 'OneSkill-VibeScore/1.0',
      },
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.data?.children || []).map(c => {
      const p = c.data;
      return {
        source: 'reddit',
        external_id: p.id,
        title: p.title || '',
        url: `https://reddit.com${p.permalink}`,
        author: p.author || '',
        score: p.score || 0,
        comment_count: p.num_comments || 0,
        snippet: (p.selftext || p.title || '').substring(0, 500),
        mentioned_at: new Date(p.created_utc * 1000).toISOString(),
      };
    });
  } catch { return []; }
}

async function batchRedditMentions(artifacts) {
  const results = new Map();
  const token = await getRedditToken();
  if (!token) {
    log('⚠️', 'Reddit: skipping (no credentials)');
    return results;
  }

  log('🔴', `Searching Reddit for ${artifacts.length} artifacts`);

  for (let i = 0; i < artifacts.length; i++) {
    const a = artifacts[i];
    const hits = await searchReddit(a.name);
    // Filter for relevance
    const relevant = hits.filter(h =>
      h.title.toLowerCase().includes(a.name.toLowerCase()) ||
      h.snippet.toLowerCase().includes(a.name.toLowerCase())
    );
    if (relevant.length > 0) results.set(a.id, relevant);
    await sleep(650); // Reddit: 100 req/min with OAuth
    if (i > 0 && i % 100 === 0) log('  ', `Reddit: ${i}/${artifacts.length} (${results.size} with mentions)`);
  }

  log('  ', `Reddit: ${results.size} artifacts with mentions`);
  return results;
}

// ─── 5. Dev.to ────────────────────────────────────────────────────────

async function searchDevTo(query) {
  const url = `https://dev.to/api/articles?per_page=5&top=30&tag=${encodeURIComponent(query)}`;
  const urlSearch = `https://dev.to/api/articles?per_page=5&top=30&search=${encodeURIComponent(query)}`;
  try {
    // Try search endpoint
    const res = await fetch(urlSearch, {
      headers: { 'User-Agent': 'OneSkill-VibeScore/1.0' },
    });
    if (!res.ok) return [];
    const articles = await res.json();
    return articles.map(a => ({
      source: 'devto',
      external_id: String(a.id),
      title: a.title || '',
      url: a.url || '',
      author: a.user?.username || '',
      score: a.positive_reactions_count || 0,
      comment_count: a.comments_count || 0,
      snippet: (a.description || '').substring(0, 500),
      mentioned_at: a.published_at || new Date().toISOString(),
    }));
  } catch { return []; }
}

async function batchDevToMentions(artifacts) {
  const results = new Map();
  // Only search artifacts with >50 stars (Dev.to coverage is sparse for tiny projects)
  const filtered = artifacts.filter(a => a.stars > 50);
  log('📝', `Searching Dev.to for ${filtered.length} artifacts (stars>50)`);

  for (let i = 0; i < filtered.length; i++) {
    const a = filtered[i];
    const hits = await searchDevTo(a.name);
    const relevant = hits.filter(h =>
      h.title.toLowerCase().includes(a.name.toLowerCase()) ||
      h.snippet.toLowerCase().includes(a.name.toLowerCase())
    );
    if (relevant.length > 0) results.set(a.id, relevant);
    await sleep(500);
    if (i > 0 && i % 100 === 0) log('  ', `Dev.to: ${i}/${filtered.length} (${results.size} with mentions)`);
  }

  log('  ', `Dev.to: ${results.size} artifacts with mentions`);
  return results;
}

// ═══════════════════════════════════════════════════════════════════════
//  SENTIMENT ANALYSIS (Gemini — only for artifacts WITH mentions)
// ═══════════════════════════════════════════════════════════════════════

function repairJSON(raw) {
  let s = raw;
  s = s.replace(/^```(?:json)?\s*/gm, '').replace(/```\s*$/gm, '');
  s = s.replace(/,\s*([\]}])/g, '$1');
  try { return JSON.parse(s); } catch (_) { /* continue */ }
  const m = s.match(/\[[\s\S]*\]/);
  if (m) { try { return JSON.parse(m[0]); } catch (_) { /* continue */ } }
  // Character-by-character string fix
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
  throw new Error('JSON repair failed');
}

async function analyzeSentimentBatch(items) {
  if (!ENV.GEMINI_API_KEY) return items.map(() => 0);

  const prompt = `Analyze the sentiment of social media mentions for ${items.length} developer tools. Return ONLY a JSON array of ${items.length} numbers, each between -1.0 (very negative) and 1.0 (very positive). 0 = neutral.

${items.map((item, idx) => {
    const mentionTexts = item.mentions.slice(0, 3).map(m =>
      `[${m.source}] "${m.title}" (score:${m.score}, comments:${m.comment_count})`
    ).join('\n  ');
    return `### TOOL_${idx}: ${item.name}
  ${mentionTexts}`;
  }).join('\n\n')}

Return JSON array of ${items.length} floats, e.g. [0.7, -0.2, 0.5]`;

  try {
    const res = await fetch(`${GEMINI_URL}?key=${ENV.GEMINI_API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1, maxOutputTokens: items.length * 15, responseMimeType: 'application/json' },
      }),
    });
    if (!res.ok) throw new Error(`${res.status}`);
    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    const parsed = repairJSON(raw);
    const arr = Array.isArray(parsed) ? parsed : [parsed];
    // Clamp values to [-1, 1]
    return arr.map(v => Math.max(-1, Math.min(1, parseFloat(v) || 0)));
  } catch (err) {
    log('⚠️', `Sentiment batch failed: ${err.message.substring(0, 100)}`);
    return items.map(() => 0);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  VIBE SCORE COMPUTATION
// ═══════════════════════════════════════════════════════════════════════

/**
 * Vibe Score formula (0–100):
 *
 *   downloads_signal (0-30):  log10(npm + pypi weekly downloads) * 8, capped at 30
 *   mention_signal   (0-30):  mentions in last 7d * 5 + mentions in last 30d * 1, capped at 30
 *   quality_signal   (0-20):  avg(upvotes/score across mentions), log scaled, capped at 20
 *   sentiment_signal (0-10):  (sentiment_avg + 1) * 5   — maps [-1,1] to [0,10]
 *   recency_signal   (0-10):  10 if mentions in last 7d, 5 if last 30d, 0 otherwise
 */
function computeVibeScore({ npmDownloads, pypiDownloads, mentions7d, mentions30d, avgScore, sentimentAvg }) {
  const downloads = (npmDownloads || 0) + (pypiDownloads || 0);
  const downloadSignal = Math.min(30, Math.floor(Math.log10(Math.max(1, downloads)) * 8));

  const mentionSignal = Math.min(30, (mentions7d * 5) + (mentions30d * 1));

  const qualitySignal = Math.min(20, Math.floor(Math.log10(Math.max(1, avgScore)) * 10));

  const sentimentSignal = Math.round(((sentimentAvg || 0) + 1) * 5);

  const recencySignal = mentions7d > 0 ? 10 : mentions30d > 0 ? 5 : 0;

  return Math.min(100, downloadSignal + mentionSignal + qualitySignal + sentimentSignal + recencySignal);
}

// ═══════════════════════════════════════════════════════════════════════
//  MAIN PIPELINE
// ═══════════════════════════════════════════════════════════════════════

async function main() {
  const startTime = Date.now();
  validateEnv();

  // 1. Load all active artifacts
  const artifacts = await loadArtifacts();
  if (!artifacts.length) { log('⚠️', 'No artifacts found'); return; }

  // 2. Collect signals from all sources in parallel where possible
  log('🔍', '\n═══ COLLECTING SIGNALS ═══\n');

  const [npmMap, pypiMap, hnMap, redditMap, devtoMap] = await Promise.all([
    batchNpmDownloads(artifacts),
    batchPypiDownloads(artifacts),
    batchHNMentions(artifacts),
    batchRedditMentions(artifacts),
    batchDevToMentions(artifacts),
  ]);

  // 3. Merge all mentions per artifact
  const allMentions = new Map(); // artifactId → mention[]
  for (const [source, map] of [['hn', hnMap], ['reddit', redditMap], ['devto', devtoMap]]) {
    for (const [artifactId, mentions] of map) {
      if (!allMentions.has(artifactId)) allMentions.set(artifactId, []);
      allMentions.get(artifactId).push(...mentions);
    }
  }

  log('📊', `\n${allMentions.size} artifacts have social mentions\n`);

  // 4. Upsert mentions to DB
  log('💾', 'Upserting mentions to artifact_mentions');
  let mentionCount = 0;
  for (const [artifactId, mentions] of allMentions) {
    const rows = mentions.map(m => ({
      artifact_id: artifactId,
      source: m.source,
      external_id: m.external_id,
      title: m.title,
      url: m.url,
      author: m.author,
      score: m.score,
      comment_count: m.comment_count,
      snippet: m.snippet,
      mentioned_at: m.mentioned_at,
    }));
    try {
      await sbUpsert('artifact_mentions', rows, 'source,external_id');
      mentionCount += rows.length;
    } catch (err) {
      // Try individual inserts on batch failure
      for (const row of rows) {
        try { await sbUpsert('artifact_mentions', [row], 'source,external_id'); mentionCount++; }
        catch { /* skip dupes */ }
      }
    }
  }
  log('  ', `Stored ${mentionCount} mentions`);

  // 5. Sentiment analysis via Gemini (only artifacts with mentions)
  log('🤖', '\n═══ SENTIMENT ANALYSIS ═══\n');
  const sentimentMap = new Map();
  const artifactsWithMentions = artifacts.filter(a => allMentions.has(a.id));

  if (ENV.GEMINI_API_KEY && artifactsWithMentions.length > 0) {
    log('🤖', `Analyzing sentiment for ${artifactsWithMentions.length} artifacts`);
    for (let i = 0; i < artifactsWithMentions.length; i += SENTIMENT_BATCH) {
      const batch = artifactsWithMentions.slice(i, i + SENTIMENT_BATCH);
      const items = batch.map(a => ({
        name: a.name,
        mentions: allMentions.get(a.id) || [],
      }));
      const scores = await analyzeSentimentBatch(items);
      for (let j = 0; j < batch.length; j++) {
        sentimentMap.set(batch[j].id, scores[j]);
      }
      await sleep(500);
    }
    log('  ', `Sentiment scored for ${sentimentMap.size} artifacts`);
  } else {
    log('⚠️', 'Skipping sentiment (no Gemini key or no mentions)');
  }

  // 6. Compute vibe scores and update artifacts
  log('🧮', '\n═══ COMPUTING VIBE SCORES ═══\n');

  const now = new Date();
  const sevenDaysAgo = new Date(now - 7 * 86400000);
  let updated = 0;

  // Process in batches of 50 for DB updates
  for (let i = 0; i < artifacts.length; i += 50) {
    const batch = artifacts.slice(i, i + 50);

    for (const a of batch) {
      const mentions = allMentions.get(a.id) || [];
      const mentions7d = mentions.filter(m => new Date(m.mentioned_at) > sevenDaysAgo).length;
      const mentions30d = mentions.length;
      const avgScore = mentions.length > 0
        ? mentions.reduce((sum, m) => sum + (m.score || 0), 0) / mentions.length
        : 0;

      const vibeScore = computeVibeScore({
        npmDownloads: npmMap.get(a.id) || 0,
        pypiDownloads: pypiMap.get(a.id) || 0,
        mentions7d,
        mentions30d,
        avgScore,
        sentimentAvg: sentimentMap.get(a.id) || 0,
      });

      try {
        await sbPatch('artifacts', `id=eq.${a.id}`, {
          vibe_score: vibeScore,
          npm_downloads_weekly: npmMap.get(a.id) || a.npm_downloads_weekly || 0,
          pypi_downloads_weekly: pypiMap.get(a.id) || 0,
          mention_count_7d: mentions7d,
          mention_count_30d: mentions30d,
          sentiment_avg: sentimentMap.get(a.id) || 0,
          vibe_updated_at: now.toISOString(),
        });
        updated++;
      } catch (err) {
        log('  ', `Update failed for ${a.slug}: ${err.message.substring(0, 80)}`);
      }
    }
    if (i > 0 && i % 500 === 0) log('  ', `Updated ${updated}/${artifacts.length}`);
  }

  const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  log('🏁', `\nVibe score pipeline complete: ${updated} artifacts updated, ${mentionCount} mentions stored`);
  log('⏱️', `Total time: ${elapsed} min`);
}

main().catch(err => {
  console.error('\n❌ Fatal:', err);
  process.exit(1);
});
