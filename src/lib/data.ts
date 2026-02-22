import { supabase } from "./supabase";
import type { Artifact, ArtifactType, ArtifactMention, Category, Platform } from "./types";

// ─── Supabase select with joined relations ──────────────────────────

const ARTIFACT_SELECT = `
  *,
  artifact_type:artifact_types(*),
  category:categories(*),
  contributor:contributors(*),
  artifact_platforms(platform:platforms(*))
`;

// ─── Lookup data (cached at module level) ───────────────────────────

let _artifactTypes: ArtifactType[] | null = null;
let _categories: Category[] | null = null;
let _platforms: Platform[] | null = null;

export async function getArtifactTypes(): Promise<ArtifactType[]> {
  if (_artifactTypes) return _artifactTypes;
  const { data } = await supabase
    .from("artifact_types")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");
  _artifactTypes = (data || []) as ArtifactType[];
  return _artifactTypes;
}

export async function getCategories(): Promise<Category[]> {
  if (_categories) return _categories;
  const { data } = await supabase
    .from("categories")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");
  _categories = (data || []) as Category[];
  return _categories;
}

export async function getPlatforms(): Promise<Platform[]> {
  if (_platforms) return _platforms;
  const { data } = await supabase
    .from("platforms")
    .select("*")
    .eq("is_active", true)
    .order("sort_order");
  _platforms = (data || []) as Platform[];
  return _platforms;
}

// ─── Artifact queries ───────────────────────────────────────────────

export async function getArtifacts(): Promise<Artifact[]> {
  try {
    const { data, error } = await supabase
      .from("artifacts")
      .select(ARTIFACT_SELECT)
      .eq("status", "active")
      .order("trending_score", { ascending: false });

    if (error || !data || data.length === 0) {
      return mockArtifacts;
    }
    return data as Artifact[];
  } catch {
    return mockArtifacts;
  }
}

export async function getArtifactBySlug(
  slug: string
): Promise<Artifact | null> {
  try {
    const { data, error } = await supabase
      .from("artifacts")
      .select(ARTIFACT_SELECT)
      .eq("slug", slug)
      .single();

    if (error || !data) {
      return mockArtifacts.find((a) => a.slug === slug) || null;
    }
    return data as Artifact;
  } catch {
    return mockArtifacts.find((a) => a.slug === slug) || null;
  }
}

export async function getArtifactById(id: string): Promise<Artifact | null> {
  // Support both UUID and slug lookups
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      id
    );

  if (isUuid) {
    try {
      const { data, error } = await supabase
        .from("artifacts")
        .select(ARTIFACT_SELECT)
        .eq("id", id)
        .single();
      if (!error && data) return data as Artifact;
    } catch {
      /* fall through */
    }
  }

  // Try by slug
  return getArtifactBySlug(id);
}

export async function getFeaturedArtifacts(): Promise<Artifact[]> {
  try {
    const { data, error } = await supabase
      .from("artifacts")
      .select(ARTIFACT_SELECT)
      .eq("is_featured", true)
      .eq("status", "active")
      .order("trending_score", { ascending: false })
      .limit(4);

    if (error || !data || data.length === 0) {
      return mockArtifacts
        .filter((a) => a.is_featured)
        .sort((a, b) => b.trending_score - a.trending_score)
        .slice(0, 4);
    }
    return data as Artifact[];
  } catch {
    return mockArtifacts
      .filter((a) => a.is_featured)
      .sort((a, b) => b.trending_score - a.trending_score)
      .slice(0, 4);
  }
}

/**
 * Curated artifacts: manually featured (is_featured=true) + auto top picks,
 * deduplicated and limited to `limit`. Manual picks appear first.
 */
export async function getCuratedArtifacts(limit = 6): Promise<Artifact[]> {
  try {
    // 1. Manually curated (is_featured = true)
    const { data: manual } = await supabase
      .from("artifacts")
      .select(ARTIFACT_SELECT)
      .eq("is_featured", true)
      .eq("status", "active")
      .order("trending_score", { ascending: false })
      .limit(limit);

    const manualList = (manual || []) as Artifact[];
    const manualIds = new Set(manualList.map((a) => a.id));

    // 2. Auto top picks by combined score (fill remaining slots)
    const remaining = limit - manualList.length;
    let autoList: Artifact[] = [];
    if (remaining > 0) {
      const { data: auto } = await supabase
        .from("artifacts")
        .select(ARTIFACT_SELECT)
        .eq("status", "active")
        .order("vibe_score", { ascending: false })
        .order("trending_score", { ascending: false })
        .limit(remaining + manualList.length); // fetch extra to allow dedup

      autoList = ((auto || []) as Artifact[])
        .filter((a) => !manualIds.has(a.id))
        .slice(0, remaining);
    }

    const combined = [...manualList, ...autoList];
    return combined.length > 0 ? combined : mockArtifacts.slice(0, limit);
  } catch {
    return mockArtifacts.slice(0, limit);
  }
}

export async function getRecentlyAdded(limit = 6): Promise<Artifact[]> {
  try {
    const { data, error } = await supabase
      .from("artifacts")
      .select(ARTIFACT_SELECT)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error || !data || data.length === 0) {
      return mockArtifacts.slice(0, limit);
    }
    return data as Artifact[];
  } catch {
    return mockArtifacts.slice(0, limit);
  }
}

export async function getRecentArtifacts(): Promise<Artifact[]> {
  try {
    const { data, error } = await supabase
      .from("artifacts")
      .select(ARTIFACT_SELECT)
      .eq("status", "active")
      .order("github_updated_at", { ascending: false })
      .limit(8);

    if (error || !data || data.length === 0) {
      return [...mockArtifacts]
        .sort(
          (a, b) =>
            new Date(b.github_updated_at).getTime() -
            new Date(a.github_updated_at).getTime()
        )
        .slice(0, 8);
    }
    return data as Artifact[];
  } catch {
    return [...mockArtifacts]
      .sort(
        (a, b) =>
          new Date(b.github_updated_at).getTime() -
          new Date(a.github_updated_at).getTime()
      )
      .slice(0, 8);
  }
}

export async function getArtifactsByContributor(
  username: string
): Promise<Artifact[]> {
  try {
    const { data, error } = await supabase
      .from("artifacts")
      .select(ARTIFACT_SELECT)
      .eq("status", "active")
      .eq("contributor.github_username", username)
      .order("trending_score", { ascending: false });

    if (error || !data) return [];
    return data as Artifact[];
  } catch {
    return [];
  }
}

// ─── Mention queries ──────────────────────────────────────────────────

export async function getMentionsForArtifact(
  artifactId: string,
  limit = 10
): Promise<ArtifactMention[]> {
  try {
    const { data, error } = await supabase
      .from("artifact_mentions")
      .select("*")
      .eq("artifact_id", artifactId)
      .order("mentioned_at", { ascending: false })
      .limit(limit);

    if (error || !data) return [];
    return data as ArtifactMention[];
  } catch {
    return [];
  }
}

// ─── Fallback mock data ─────────────────────────────────────────────
// Used when Supabase has no artifacts yet (pre-scraper-run)

const now = new Date().toISOString();

const mockArtifacts: Artifact[] = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    slug: "upstash-context7",
    name: "Context7 MCP Server",
    description:
      "Up-to-date code documentation for LLMs and AI code editors via MCP.",
    long_description:
      "Context7 is a Model Context Protocol server that provides up-to-date documentation and code examples for any library or framework. It resolves the hallucination problem by fetching real, verified docs.",
    artifact_type_id: "",
    category_id: "",
    contributor_id: null,
    github_url: "https://github.com/upstash/context7",
    github_repo_full_name: "upstash/context7",
    default_branch: "main",
    language: "TypeScript",
    license: "MIT",
    install_command: "npx @upstash/context7-mcp",
    npm_package_name: "@upstash/context7-mcp",
    stars: 46252,
    forks: 2197,
    open_issues: 0,
    weekly_downloads: 45000,
    trending_score: 99,
    version: "1.0.0",
    readme_raw: null,
    readme_excerpt: null,
    tags: ["mcp", "documentation", "llm", "typescript", "context"],
    meta_title: "Context7 MCP Server — OneSkill",
    meta_description:
      "Up-to-date code documentation for LLMs via Model Context Protocol.",
    status: "active",
    source: "mock",
    is_featured: true,
    github_created_at: "2025-06-01T00:00:00Z",
    github_updated_at: "2026-02-20T00:00:00Z",
    last_pipeline_sync: null,
    vibe_score: 0,
    npm_downloads_weekly: 0,
    pypi_downloads_weekly: 0,
    mention_count_7d: 0,
    mention_count_30d: 0,
    sentiment_avg: 0,
    vibe_updated_at: null,
    created_at: now,
    updated_at: now,
    artifact_type: {
      id: "",
      slug: "mcp-server",
      label: "MCP Server",
      description: "",
      is_active: true,
      sort_order: 2,
    },
    category: {
      id: "",
      slug: "documentation",
      label: "Documentation",
      is_active: true,
      sort_order: 14,
    },
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    slug: "vercel-labs-agent-skills",
    name: "Vercel Agent Skills",
    description:
      "React 19 patterns, Server Components, and Next.js App Router conventions from Vercel.",
    long_description:
      "The definitive skill for building React applications the Vercel way. Covers RSC, streaming, and Vercel platform best practices.",
    artifact_type_id: "",
    category_id: "",
    contributor_id: null,
    github_url: "https://github.com/vercel-labs/agent-skills",
    github_repo_full_name: "vercel-labs/agent-skills",
    default_branch: "main",
    language: "TypeScript",
    license: "MIT",
    install_command: "npx skills add vercel-labs/agent-skills",
    npm_package_name: null,
    stars: 20777,
    forks: 1234,
    open_issues: 0,
    weekly_downloads: 138600,
    trending_score: 97,
    version: "3.1.0",
    readme_raw: null,
    readme_excerpt: null,
    tags: ["react", "nextjs", "server-components", "vercel", "performance"],
    meta_title: "Vercel Agent Skills — OneSkill",
    meta_description:
      "React 19, Server Components, and Next.js App Router best practices skill.",
    status: "active",
    source: "mock",
    is_featured: true,
    github_created_at: "2025-01-01T00:00:00Z",
    github_updated_at: "2026-02-16T00:00:00Z",
    last_pipeline_sync: null,
    vibe_score: 0,
    npm_downloads_weekly: 0,
    pypi_downloads_weekly: 0,
    mention_count_7d: 0,
    mention_count_30d: 0,
    sentiment_avg: 0,
    vibe_updated_at: null,
    created_at: now,
    updated_at: now,
    artifact_type: {
      id: "",
      slug: "skill",
      label: "Skill",
      description: "",
      is_active: true,
      sort_order: 1,
    },
    category: {
      id: "",
      slug: "frontend",
      label: "Frontend",
      is_active: true,
      sort_order: 1,
    },
  },
  {
    id: "00000000-0000-0000-0000-000000000003",
    slug: "github-github-mcp-server",
    name: "GitHub MCP Server",
    description:
      "Model Context Protocol server for GitHub. Repos, issues, PRs, code search.",
    long_description:
      "A full-featured MCP server that gives your coding agent direct access to GitHub's API for repository management, issue tracking, and code search.",
    artifact_type_id: "",
    category_id: "",
    contributor_id: null,
    github_url: "https://github.com/github/github-mcp-server",
    github_repo_full_name: "github/github-mcp-server",
    default_branch: "main",
    language: "TypeScript",
    license: "MIT",
    install_command: "npx @github/mcp-server",
    npm_package_name: "@github/mcp-server",
    stars: 12450,
    forks: 1890,
    open_issues: 0,
    weekly_downloads: 45200,
    trending_score: 95,
    version: "2.1.0",
    readme_raw: null,
    readme_excerpt: null,
    tags: ["github", "mcp", "api", "repository", "pull-requests"],
    meta_title: "GitHub MCP Server — OneSkill",
    meta_description:
      "Full-featured MCP server for GitHub: repos, issues, PRs, and code search.",
    status: "active",
    source: "mock",
    is_featured: true,
    github_created_at: "2025-03-01T00:00:00Z",
    github_updated_at: "2026-02-18T00:00:00Z",
    last_pipeline_sync: null,
    vibe_score: 0,
    npm_downloads_weekly: 0,
    pypi_downloads_weekly: 0,
    mention_count_7d: 0,
    mention_count_30d: 0,
    sentiment_avg: 0,
    vibe_updated_at: null,
    created_at: now,
    updated_at: now,
    artifact_type: {
      id: "",
      slug: "mcp-server",
      label: "MCP Server",
      description: "",
      is_active: true,
      sort_order: 2,
    },
    category: {
      id: "",
      slug: "devops",
      label: "DevOps",
      is_active: true,
      sort_order: 3,
    },
  },
  {
    id: "00000000-0000-0000-0000-000000000004",
    slug: "browser-use-browser-use",
    name: "Browser Use",
    description:
      "Agent skill for browser automation. Navigate, click, fill forms, extract data.",
    long_description:
      "Give your coding agent the ability to control a browser. Supports Playwright-based navigation, form filling, screenshot capture, and data extraction.",
    artifact_type_id: "",
    category_id: "",
    contributor_id: null,
    github_url: "https://github.com/browser-use/browser-use",
    github_repo_full_name: "browser-use/browser-use",
    default_branch: "main",
    language: "Python",
    license: "MIT",
    install_command: "pip install browser-use",
    npm_package_name: null,
    stars: 78578,
    forks: 1567,
    open_issues: 0,
    weekly_downloads: 31700,
    trending_score: 92,
    version: "1.8.0",
    readme_raw: null,
    readme_excerpt: null,
    tags: ["browser", "automation", "scraping", "playwright", "testing"],
    meta_title: "Browser Use — OneSkill",
    meta_description:
      "Agent skill for browser automation with Playwright. Navigate, click, extract.",
    status: "active",
    source: "mock",
    is_featured: true,
    github_created_at: "2025-02-01T00:00:00Z",
    github_updated_at: "2026-02-19T00:00:00Z",
    last_pipeline_sync: null,
    vibe_score: 0,
    npm_downloads_weekly: 0,
    pypi_downloads_weekly: 0,
    mention_count_7d: 0,
    mention_count_30d: 0,
    sentiment_avg: 0,
    vibe_updated_at: null,
    created_at: now,
    updated_at: now,
    artifact_type: {
      id: "",
      slug: "skill",
      label: "Skill",
      description: "",
      is_active: true,
      sort_order: 1,
    },
    category: {
      id: "",
      slug: "automation",
      label: "Automation",
      is_active: true,
      sort_order: 7,
    },
  },
];
