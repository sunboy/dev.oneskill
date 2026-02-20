#!/usr/bin/env node

/**
 * GitHub Artifact Scraper
 * Searches GitHub for agent artifacts and enriches metadata using Gemini API
 * Updates Supabase database with discovered artifacts
 */

// Configuration
const CONFIG = {
  MAX_REPOS_PER_RUN: 50,
  GITHUB_API_URL: 'https://api.github.com',
  GEMINI_API_URL: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
  CATEGORIES: [
    'Automation',
    'Code Generation',
    'Data Analysis',
    'DevOps',
    'Documentation',
    'Frontend',
    'Backend',
    'Research',
    'Security',
    'Testing',
    'Web Scraping',
    'Workflow',
    'AI / ML',
  ],
  SEARCH_QUERIES: [
    { type: 'mcp-server', query: 'topic:mcp-server sort:stars' },
    { type: 'cursor-rules', query: 'topic:cursor-rules OR filename:.cursorrules sort:stars' },
    { type: 'skill', query: 'topic:oneskill OR filename:SKILL.md sort:stars' },
    { type: 'n8n-node', query: 'topic:n8n-community-node sort:stars' },
    { type: 'langchain-tool', query: 'topic:langchain-tool sort:stars' },
    { type: 'crewai-tool', query: 'topic:crewai-tool sort:stars' },
  ],
};

// Environment variables
const ENV = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  GITHUB_PAT: process.env.GITHUB_PAT,
  GITHUB_TOKEN: process.env.GITHUB_TOKEN,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
};

// Validate environment
function validateEnvironment() {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'GEMINI_API_KEY',
  ];
  const missing = required.filter(key => !ENV[key]);
  if (missing.length > 0) {
    console.error(`❌ Missing required environment variables: ${missing.join(', ')}`);
    process.exit(1);
  }
  console.log('✅ Environment validation passed');
}

// GitHub API helper with rate limiting
class GitHubAPI {
  constructor(token) {
    this.token = token;
    this.rateLimitRemaining = 60;
    this.rateLimitReset = 0;
  }

  async fetch(endpoint, options = {}) {
    const url = `${CONFIG.GITHUB_API_URL}${endpoint}`;
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      ...options.headers,
    };

    if (this.token) {
      headers['Authorization'] = `token ${this.token}`;
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    // Update rate limit info
    const remaining = response.headers.get('x-ratelimit-remaining');
    const reset = response.headers.get('x-ratelimit-reset');
    if (remaining !== null) this.rateLimitRemaining = parseInt(remaining, 10);
    if (reset !== null) this.rateLimitReset = parseInt(reset, 10) * 1000;

    if (response.status === 403 || response.status === 429) {
      const resetDate = new Date(this.rateLimitReset);
      console.warn(`⏳ Rate limited. Reset at ${resetDate.toISOString()}`);
      throw new Error('GitHub API rate limited');
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API error ${response.status}: ${text}`);
    }

    return response.json();
  }

  async searchRepositories(query) {
    console.log(`🔍 Searching: ${query}`);
    const data = await this.fetch(
      `/search/repositories?q=${encodeURIComponent(query)}&per_page=30`
    );
    return data.items || [];
  }

  async getRepositoryReadme(owner, repo) {
    try {
      const data = await this.fetch(`/repos/${owner}/${repo}/readme`, {
        headers: { 'Accept': 'application/vnd.github.v3.raw' },
      });
      return typeof data === 'string' ? data : null;
    } catch (error) {
      return null;
    }
  }
}

// Gemini API helper for metadata enrichment
class GeminiAPI {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async enrichArtifact(repo, readme) {
    const prompt = this.buildPrompt(repo, readme);

    try {
      const response = await fetch(
        `${CONFIG.GEMINI_API_URL}?key=${this.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 1000,
            },
          }),
        }
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Gemini API error ${response.status}: ${text}`);
      }

      const data = await response.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return this.parseGeminiResponse(text);
    } catch (error) {
      console.error(`⚠️ Gemini enrichment failed: ${error.message}`);
      return this.getDefaults(repo);
    }
  }

  buildPrompt(repo, readme) {
    const readmeExcerpt = readme
      ? readme.substring(0, 1000)
      : 'No README found';

    return `You are analyzing a GitHub repository for an agent artifact. Extract and suggest metadata.

Repository Details:
- Name: ${repo.name}
- Description: ${repo.description || 'No description'}
- Language: ${repo.language || 'Unknown'}
- Stars: ${repo.stargazers_count}
- README (first 1000 chars): ${readmeExcerpt}

Please provide a JSON response (only valid JSON, no markdown) with these fields:
{
  "long_description": "2-3 sentence comprehensive description of what this artifact does",
  "category": "One of: ${CONFIG.CATEGORIES.join(', ')}",
  "tags": ["relevant", "tags", "describing", "the", "artifact"],
  "artifact_type": "mcp-server|cursor-rule|skill|n8n-node|langchain-tool|crewai-tool",
  "compatible_platforms": ["platform1", "platform2"],
  "install_command": "npm install command or pip install or appropriate",
  "trending_score": 45
}

Trending score should be 0-100 based on stars (0-100), recency, and likely community adoption.`;
  }

  parseGeminiResponse(text) {
    try {
      // Try to extract JSON from the response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      throw new Error('No JSON found in response');
    } catch (error) {
      console.warn(`⚠️ Failed to parse Gemini response: ${error.message}`);
      return null;
    }
  }

  getDefaults(repo) {
    return {
      long_description: repo.description || 'No description available',
      category: 'AI / ML',
      tags: ['agent', 'artifact'],
      artifact_type: 'skill',
      compatible_platforms: [],
      install_command: 'npm install',
      trending_score: Math.min(100, Math.max(0, Math.floor(Math.log(repo.stargazers_count + 1) * 10))),
    };
  }
}

// Supabase API helper
class SupabaseAPI {
  constructor(url, serviceRoleKey) {
    this.url = url;
    this.serviceRoleKey = serviceRoleKey;
  }

  async upsertArtifacts(artifacts) {
    if (artifacts.length === 0) return { count: 0 };

    const payload = artifacts.map(artifact => ({
      id: artifact.id,
      name: artifact.name,
      description: artifact.description,
      long_description: artifact.long_description,
      author: artifact.author,
      author_github: artifact.author_github,
      github_url: artifact.github_url,
      stars: artifact.stars,
      forks: artifact.forks,
      last_updated: artifact.last_updated,
      category: artifact.category,
      tags: artifact.tags,
      artifact_type: artifact.artifact_type,
      compatible_platforms: artifact.compatible_platforms,
      language: artifact.language,
      license: artifact.license,
      version: artifact.version,
      install_command: artifact.install_command,
      npx_skills_command: artifact.npx_skills_command,
      trending_score: artifact.trending_score,
      readme: artifact.readme,
    }));

    try {
      const response = await fetch(
        `${this.url}/rest/v1/artifacts`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.serviceRoleKey}`,
            'apikey': this.serviceRoleKey,
            'Prefer': 'resolution=merge-duplicates',
          },
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Supabase API error ${response.status}: ${text}`);
      }

      console.log(`✅ Upserted ${payload.length} artifacts to Supabase`);
      return { count: payload.length };
    } catch (error) {
      console.error(`❌ Supabase upsert failed: ${error.message}`);
      throw error;
    }
  }
}

// Main scraper logic
async function runScraper() {
  validateEnvironment();

  const github = new GitHubAPI(ENV.GITHUB_PAT || ENV.GITHUB_TOKEN);
  const gemini = new GeminiAPI(ENV.GEMINI_API_KEY);
  const supabase = new SupabaseAPI(ENV.SUPABASE_URL, ENV.SUPABASE_SERVICE_ROLE_KEY);

  const allRepos = new Map();
  let totalProcessed = 0;

  // Search GitHub for repositories
  console.log('\n📊 Starting GitHub search...\n');

  for (const { type, query } of CONFIG.SEARCH_QUERIES) {
    if (totalProcessed >= CONFIG.MAX_REPOS_PER_RUN) {
      console.log(`⏸️  Reached max repos limit (${CONFIG.MAX_REPOS_PER_RUN})`);
      break;
    }

    try {
      const repos = await github.searchRepositories(query);
      const remaining = CONFIG.MAX_REPOS_PER_RUN - totalProcessed;
      const toProcess = repos.slice(0, remaining);

      console.log(`  Found ${repos.length} repos, processing ${toProcess.length}`);

      for (const repo of toProcess) {
        const key = `${repo.owner.login}/${repo.name}`;
        if (!allRepos.has(key)) {
          allRepos.set(key, { ...repo, artifact_type: type });
        }
      }

      totalProcessed = allRepos.size;
    } catch (error) {
      console.error(`❌ Search failed for "${query}": ${error.message}`);
    }
  }

  console.log(`\n📦 Found ${allRepos.size} unique repositories\n`);

  // Enrich with Gemini and prepare for Supabase
  const artifactsToUpsert = [];

  for (const [repoKey, repo] of allRepos) {
    try {
      console.log(`🔄 Processing: ${repoKey}`);

      // Fetch README
      const readme = await github.getRepositoryReadme(
        repo.owner.login,
        repo.name
      );

      // Enrich with Gemini
      const enrichment = await gemini.enrichArtifact(repo, readme);

      // Build artifact object
      const artifact = {
        id: repoKey.replace('/', '-').toLowerCase(),
        name: repo.name,
        description: repo.description || '',
        long_description: enrichment?.long_description || repo.description || '',
        author: repo.owner.login,
        author_github: repo.owner.login,
        github_url: repo.html_url,
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        last_updated: repo.updated_at,
        category: enrichment?.category || 'AI / ML',
        tags: enrichment?.tags || ['agent'],
        artifact_type: enrichment?.artifact_type || repo.artifact_type || 'skill',
        compatible_platforms: enrichment?.compatible_platforms || [],
        language: repo.language || null,
        license: repo.license?.name || null,
        version: null,
        install_command: enrichment?.install_command || null,
        npx_skills_command: null,
        trending_score: enrichment?.trending_score || 0,
        readme: readme ? readme.substring(0, 10000) : null,
      };

      artifactsToUpsert.push(artifact);
      console.log(`  ✓ ${artifact.name} (${artifact.category})`);
    } catch (error) {
      console.error(`  ✗ Failed to process ${repoKey}: ${error.message}`);
    }
  }

  // Upsert to Supabase
  if (artifactsToUpsert.length > 0) {
    console.log(`\n💾 Upserting ${artifactsToUpsert.length} artifacts to Supabase...\n`);
    await supabase.upsertArtifacts(artifactsToUpsert);
  } else {
    console.log('\n⚠️  No artifacts to upsert');
  }

  console.log('\n✨ Scraping completed successfully!\n');
  return {
    repositories_found: allRepos.size,
    artifacts_processed: artifactsToUpsert.length,
  };
}

// Execute
runScraper().catch(error => {
  console.error('\n❌ Fatal error:', error.message);
  process.exit(1);
});
