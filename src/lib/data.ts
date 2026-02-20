import { supabase } from "./supabase";
import type { Artifact } from "./types";

// Fallback mock data used when Supabase has no artifacts yet
const skillPlatforms = [
  "Claude Code", "Cursor", "Antigravity", "OpenClaw", "Codex", "Windsurf",
  "GitHub Copilot", "Gemini CLI", "Cline", "Roo Code", "Kiro CLI", "OpenCode",
  "Goose", "Augment", "Trae", "Qwen Code", "Replit", "Amp",
];
const mcpPlatforms = [
  "Claude Code", "Cursor", "Cline", "Windsurf", "Roo Code", "OpenCode", "Kiro CLI", "Continue",
];

export const mockArtifacts: Artifact[] = [
  {
    id: "supabase-postgres-best-practices",
    name: "Supabase Postgres Best Practices",
    description: "Production-ready Supabase patterns covering RLS policies, edge functions, migrations, and performance optimization.",
    long_description: "A comprehensive skill that teaches your coding agent how to build production-grade Supabase applications.",
    author: "Supabase",
    author_github: "supabase",
    github_url: "https://github.com/supabase/agent-skills",
    stars: 4890, forks: 567, last_updated: "2026-02-15", category: "Backend",
    tags: ["supabase", "postgresql", "database", "rls", "edge-functions"],
    artifact_type: "skill", compatible_platforms: skillPlatforms,
    language: "SQL / TypeScript", license: "Apache-2.0", version: "1.4.0",
    install_command: "npx skills add supabase/agent-skills --skill supabase-postgres-best-practices",
    npx_skills_command: "npx skills add supabase/agent-skills --skill supabase-postgres-best-practices",
    weekly_downloads: 18900, verified: true, is_featured: true, trending_score: 94,
    readme: "# Supabase Postgres Best Practices\n\nProduction patterns for Supabase applications.",
  },
  {
    id: "vercel-react-best-practices",
    name: "Vercel React Best Practices",
    description: "React 19 patterns, Server Components, and Next.js App Router conventions from Vercel's engineering team.",
    long_description: "The definitive skill for building React applications the Vercel way.",
    author: "Vercel", author_github: "vercel-labs",
    github_url: "https://github.com/vercel-labs/agent-skills",
    stars: 8920, forks: 1234, last_updated: "2026-02-16", category: "Frontend",
    tags: ["react", "nextjs", "server-components", "vercel", "performance"],
    artifact_type: "skill", compatible_platforms: skillPlatforms,
    language: "TypeScript", license: "MIT", version: "3.1.0",
    install_command: "npx skills add vercel-labs/agent-skills --skill vercel-react-best-practices",
    npx_skills_command: "npx skills add vercel-labs/agent-skills --skill vercel-react-best-practices",
    weekly_downloads: 138600, verified: true, is_featured: true, trending_score: 99,
    readme: "# Vercel React Best Practices",
  },
  {
    id: "github-mcp-server",
    name: "GitHub MCP Server",
    description: "Model Context Protocol server for GitHub. Repository management, issue tracking, PR reviews, and code search.",
    long_description: "A full-featured MCP server that gives your coding agent direct access to GitHub's API.",
    author: "GitHub", author_github: "github",
    github_url: "https://github.com/github/github-mcp-server",
    stars: 12450, forks: 1890, last_updated: "2026-02-16", category: "DevOps",
    tags: ["github", "mcp", "api", "repository", "pull-requests"],
    artifact_type: "mcp_server", compatible_platforms: mcpPlatforms,
    language: "TypeScript", license: "MIT", version: "2.1.0",
    install_command: "npx @github/mcp-server",
    weekly_downloads: 45200, verified: true, is_featured: true, trending_score: 97,
    readme: "# GitHub MCP Server",
  },
  {
    id: "frontend-design-anthropic",
    name: "Frontend Design",
    description: "Anthropic's official skill for building beautiful, accessible UIs. Layout systems, color theory, typography, and responsive design.",
    long_description: "The official Anthropic skill for frontend design.",
    author: "Anthropic", author_github: "anthropics",
    github_url: "https://github.com/anthropics/skills",
    stars: 6780, forks: 890, last_updated: "2026-02-14", category: "Frontend",
    tags: ["design", "ui-ux", "accessibility", "css", "layout"],
    artifact_type: "skill", compatible_platforms: skillPlatforms,
    language: "CSS / TypeScript", license: "MIT", version: "2.0.0",
    install_command: "npx skills add anthropics/skills --skill frontend-design",
    npx_skills_command: "npx skills add anthropics/skills --skill frontend-design",
    weekly_downloads: 74000, verified: true, is_featured: true, trending_score: 96,
    readme: "# Frontend Design",
  },
  {
    id: "cursor-nextjs-rules",
    name: "Next.js Cursor Rules",
    description: "Comprehensive .cursorrules for Next.js 15 projects. App Router conventions, TypeScript strictness, and Tailwind CSS patterns.",
    long_description: "A curated set of Cursor rules that enforce Next.js 15 best practices.",
    author: "Patrick JS", author_github: "patrickjs",
    github_url: "https://github.com/patrickjs/awesome-cursorrules",
    stars: 7890, forks: 1456, last_updated: "2026-02-13", category: "Frontend",
    tags: ["cursor", "nextjs", "rules", "typescript", "tailwind"],
    artifact_type: "cursor_rule", compatible_platforms: ["Cursor"],
    language: "Markdown", license: "MIT", version: "4.2.0",
    install_command: "curl -o .cursorrules https://raw.githubusercontent.com/patrickjs/awesome-cursorrules/main/rules/nextjs-15.cursorrules",
    weekly_downloads: 23400, verified: true, is_featured: false, trending_score: 78,
    readme: "# Next.js Cursor Rules",
  },
  {
    id: "browser-use-skill",
    name: "Browser Use",
    description: "Agent skill for browser automation. Navigate, click, fill forms, extract data, and take screenshots.",
    long_description: "Give your coding agent the ability to control a browser.",
    author: "Browser Use", author_github: "browser-use",
    github_url: "https://github.com/browser-use/browser-use",
    stars: 9340, forks: 1567, last_updated: "2026-02-16", category: "Automation",
    tags: ["browser", "automation", "scraping", "playwright", "testing"],
    artifact_type: "skill", compatible_platforms: skillPlatforms,
    language: "Python", license: "MIT", version: "1.8.0",
    install_command: "npx skills add browser-use/browser-use",
    npx_skills_command: "npx skills add browser-use/browser-use",
    weekly_downloads: 31700, verified: true, is_featured: true, trending_score: 92,
    readme: "# Browser Use",
  },
  {
    id: "supabase-mcp-server",
    name: "Supabase MCP Server",
    description: "MCP server for Supabase. Query databases, manage auth users, invoke edge functions, and interact with storage.",
    long_description: "A Model Context Protocol server for full Supabase access.",
    author: "Supabase", author_github: "supabase",
    github_url: "https://github.com/supabase/mcp-server",
    stars: 5670, forks: 780, last_updated: "2026-02-16", category: "Backend",
    tags: ["supabase", "mcp", "database", "auth", "storage"],
    artifact_type: "mcp_server", compatible_platforms: mcpPlatforms,
    language: "TypeScript", license: "Apache-2.0", version: "1.2.0",
    install_command: "npx @supabase/mcp-server",
    weekly_downloads: 12300, verified: true, is_featured: true, trending_score: 88,
    readme: "# Supabase MCP Server",
  },
  {
    id: "remotion-best-practices",
    name: "Remotion Best Practices",
    description: "Official Remotion skill for programmatic video generation. Composition design, animation patterns, rendering pipelines.",
    long_description: "The official skill from the Remotion team for building programmatic videos with React.",
    author: "Remotion", author_github: "remotion-dev",
    github_url: "https://github.com/remotion-dev/skills",
    stars: 3450, forks: 234, last_updated: "2026-02-12", category: "Frontend",
    tags: ["remotion", "video", "react", "animation", "rendering"],
    artifact_type: "skill", compatible_platforms: skillPlatforms,
    language: "TypeScript", license: "MIT", version: "1.2.0",
    install_command: "npx skills add remotion-dev/skills --skill remotion-best-practices",
    npx_skills_command: "npx skills add remotion-dev/skills --skill remotion-best-practices",
    weekly_downloads: 94500, verified: true, is_featured: true, trending_score: 91,
    readme: "# Remotion Best Practices",
  },
];

export async function getArtifacts(): Promise<Artifact[]> {
  try {
    const { data, error } = await supabase
      .from("artifacts")
      .select("*")
      .order("trending_score", { ascending: false });

    if (error || !data || data.length === 0) {
      return mockArtifacts;
    }
    return data as Artifact[];
  } catch {
    return mockArtifacts;
  }
}

export async function getArtifactById(id: string): Promise<Artifact | null> {
  try {
    const { data, error } = await supabase
      .from("artifacts")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) {
      return mockArtifacts.find(a => a.id === id) || null;
    }
    return data as Artifact;
  } catch {
    return mockArtifacts.find(a => a.id === id) || null;
  }
}

export async function getFeaturedArtifacts(): Promise<Artifact[]> {
  try {
    const { data, error } = await supabase
      .from("artifacts")
      .select("*")
      .eq("is_featured", true)
      .order("trending_score", { ascending: false })
      .limit(4);

    if (error || !data || data.length === 0) {
      return mockArtifacts.filter(a => a.is_featured).sort((a, b) => b.trending_score - a.trending_score).slice(0, 4);
    }
    return data as Artifact[];
  } catch {
    return mockArtifacts.filter(a => a.is_featured).sort((a, b) => b.trending_score - a.trending_score).slice(0, 4);
  }
}

export async function getRecentArtifacts(): Promise<Artifact[]> {
  try {
    const { data, error } = await supabase
      .from("artifacts")
      .select("*")
      .order("last_updated", { ascending: false })
      .limit(8);

    if (error || !data || data.length === 0) {
      return [...mockArtifacts].sort((a, b) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()).slice(0, 8);
    }
    return data as Artifact[];
  } catch {
    return [...mockArtifacts].sort((a, b) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()).slice(0, 8);
  }
}
