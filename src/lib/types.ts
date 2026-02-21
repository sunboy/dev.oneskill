// ─── Artifact type slugs (match artifact_types.slug in Supabase) ─────
export type ArtifactTypeSlug =
  | "skill"
  | "mcp-server"
  | "cursor-rules"
  | "n8n-node"
  | "workflow"
  | "langchain-tool"
  | "crewai-tool";

// ─── DB row shapes ──────────────────────────────────────────────────

export interface ArtifactType {
  id: string;
  slug: ArtifactTypeSlug;
  label: string;
  description: string;
  is_active: boolean;
  sort_order: number;
}

export interface Category {
  id: string;
  slug: string;
  label: string;
  is_active: boolean;
  sort_order: number;
}

export interface Platform {
  id: string;
  slug: string;
  label: string;
  website_url?: string;
  install_command_template?: string;
  is_active: boolean;
  sort_order: number;
}

export interface Contributor {
  id: string;
  github_username: string;
  display_name: string;
  avatar_url: string;
  bio?: string;
  location?: string;
  website?: string;
  github_url: string;
  followers?: number;
  public_repos?: number;
}

// ─── The main artifact, with joined relations ───────────────────────

export interface Artifact {
  id: string;
  slug: string;
  name: string;
  description: string;
  long_description: string;
  artifact_type_id: string;
  category_id: string;
  contributor_id: string | null;
  github_url: string;
  github_repo_full_name: string;
  default_branch: string;
  language: string | null;
  license: string | null;
  install_command: string;
  npm_package_name: string | null;
  stars: number;
  forks: number;
  open_issues: number;
  weekly_downloads: number;
  trending_score: number;
  version: string | null;
  readme_raw: string | null;
  readme_excerpt: string | null;
  tags: string[];
  meta_title: string | null;
  meta_description: string | null;
  status: string;
  source: string;
  is_featured: boolean;
  github_created_at: string;
  github_updated_at: string;
  last_pipeline_sync: string | null;
  created_at: string;
  updated_at: string;

  // Vibe score fields
  vibe_score: number;
  npm_downloads_weekly: number;
  pypi_downloads_weekly: number;
  mention_count_7d: number;
  mention_count_30d: number;
  sentiment_avg: number;
  vibe_updated_at: string | null;

  // Joined relations (populated via Supabase select)
  artifact_type?: ArtifactType;
  category?: Category;
  contributor?: Contributor;
  artifact_platforms?: { platform: Platform }[];
}

// ─── Mention type (from artifact_mentions table) ─────────────────────

export type MentionSource = "hackernews" | "reddit" | "devto" | "hashnode" | "stackoverflow" | "github_discussions";

export interface ArtifactMention {
  id: string;
  artifact_id: string;
  source: MentionSource;
  external_id: string;
  title: string;
  url: string;
  author: string;
  score: number;
  comment_count: number;
  sentiment: number | null;
  snippet: string;
  mentioned_at: string;
  created_at: string;
}

// ─── Feature flags for vibe score sources ────────────────────────────

export const VIBE_FLAGS = {
  npm: true,
  pypi: true,
  hackernews: true,
  reddit: true,
  devto: true,
  sentiment: true,
} as const;

// ─── Vibe score helpers ──────────────────────────────────────────────

export function vibeColor(score: number): string {
  if (score >= 70) return "oklch(0.58 0.22 25)";       // hot — vermillion
  if (score >= 40) return "oklch(0.65 0.18 55)";       // warm — amber
  if (score >= 20) return "oklch(0.55 0.01 60)";       // neutral — gray
  return "oklch(0.65 0.12 250)";                       // cold — blue
}

export function vibeLabel(score: number): string {
  if (score >= 70) return "Buzzing";
  if (score >= 40) return "Active";
  if (score >= 20) return "Quiet";
  return "New";
}

export function sentimentLabel(avg: number): "positive" | "neutral" | "negative" {
  if (avg > 0.2) return "positive";
  if (avg < -0.2) return "negative";
  return "neutral";
}

export const MENTION_SOURCE_META: Record<MentionSource, { label: string; shortLabel: string; color: string }> = {
  hackernews:          { label: "Hacker News",        shortLabel: "HN",  color: "#ff6600" },
  reddit:              { label: "Reddit",             shortLabel: "r/",  color: "#ff4500" },
  devto:               { label: "Dev.to",             shortLabel: "d",   color: "#0a0a0a" },
  hashnode:            { label: "Hashnode",           shortLabel: "h",   color: "#2962ff" },
  stackoverflow:       { label: "Stack Overflow",     shortLabel: "SO",  color: "#f48024" },
  github_discussions:  { label: "GitHub Discussions",  shortLabel: "GH",  color: "#24292e" },
};

// ─── UI constants ───────────────────────────────────────────────────

export const artifactTypeLabels: Record<ArtifactTypeSlug, string> = {
  skill: "Skill",
  "mcp-server": "MCP Server",
  "cursor-rules": "Cursor Rules",
  "n8n-node": "n8n Node",
  workflow: "Workflow",
  "langchain-tool": "LangChain Tool",
  "crewai-tool": "CrewAI Tool",
};

export const artifactTypeSlugs: ArtifactTypeSlug[] = [
  "skill",
  "mcp-server",
  "cursor-rules",
  "n8n-node",
  "workflow",
  "langchain-tool",
  "crewai-tool",
];

// ─── Utility functions ──────────────────────────────────────────────

export function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toString();
}

export function getTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}
