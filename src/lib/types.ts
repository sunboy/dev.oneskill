export type ArtifactType = "skill" | "mcp_server" | "cursor_rule" | "n8n_node" | "workflow" | "langchain_tool" | "crewai_tool";

export interface Artifact {
  id: string;
  name: string;
  description: string;
  long_description: string;
  author: string;
  author_github: string;
  github_url: string;
  stars: number;
  forks: number;
  last_updated: string;
  category: string;
  tags: string[];
  artifact_type: ArtifactType;
  compatible_platforms: string[];
  language: string;
  license: string;
  version: string;
  install_command: string;
  npx_skills_command?: string;
  weekly_downloads: number;
  verified: boolean;
  is_featured: boolean;
  trending_score: number;
  readme: string;
  created_at?: string;
}

export const artifactTypeLabels: Record<ArtifactType, string> = {
  skill: "Skill",
  mcp_server: "MCP Server",
  cursor_rule: "Cursor Rule",
  n8n_node: "n8n Node",
  workflow: "Workflow",
  langchain_tool: "LangChain Tool",
  crewai_tool: "CrewAI Tool",
};

export const artifactTypes: ArtifactType[] = [
  "skill", "mcp_server", "cursor_rule", "n8n_node", "workflow", "langchain_tool", "crewai_tool",
];

export const categories = [
  "All", "Automation", "Code Generation", "Data Analysis", "DevOps",
  "Documentation", "Frontend", "Backend", "Research", "Security",
  "Testing", "Web Scraping", "Workflow", "AI / ML",
] as const;

export const platforms = [
  "All", "Claude Code", "Cursor", "Antigravity", "OpenClaw", "Codex",
  "Windsurf", "GitHub Copilot", "Gemini CLI", "Cline", "Roo Code",
  "Kiro CLI", "n8n", "LangChain", "CrewAI",
] as const;

export const allPlatforms = [
  "Claude Code", "Cursor", "Antigravity", "OpenClaw", "Codex", "Windsurf",
  "GitHub Copilot", "Gemini CLI", "Cline", "Roo Code", "Kiro CLI", "OpenCode",
  "Goose", "Augment", "Trae", "Qwen Code", "Replit", "Amp", "Kimi Code CLI",
  "CodeBuddy", "Command Code", "Continue", "Crush", "Droid", "iFlow CLI",
  "Junie", "Kilo Code", "Kode", "MCPJam", "Mistral Vibe", "Mux", "OpenHands",
  "Pi", "Qoder", "Trae CN", "Zencoder",
];

export function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return n.toString();
}

export function getTimeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}
