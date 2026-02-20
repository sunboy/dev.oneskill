import Link from "next/link";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import SkillRow from "@/components/SkillRow";
import { getFeaturedArtifacts, getRecentArtifacts, getArtifacts } from "@/lib/data";
import { artifactTypeLabels, formatNumber } from "@/lib/types";
import type { Artifact } from "@/lib/types";

const stats = [
  { label: "Artifacts Indexed", value: "24,891" },
  { label: "Contributors", value: "6,420" },
  { label: "Platforms", value: "38" },
  { label: "Last Sync", value: "4 min ago" },
];

const platformData = [
  { name: "Claude Code", count: "4,231" },
  { name: "Cursor", count: "3,847" },
  { name: "Antigravity", count: "1,234" },
  { name: "OpenClaw", count: "987" },
  { name: "Codex", count: "2,156" },
  { name: "Windsurf", count: "1,892" },
  { name: "GitHub Copilot", count: "1,456" },
  { name: "Gemini CLI", count: "1,123" },
  { name: "Cline", count: "2,340" },
  { name: "Roo Code", count: "890" },
  { name: "MCP Servers", count: "3,412" },
  { name: "n8n Nodes", count: "1,567" },
  { name: "LangChain", count: "1,890" },
  { name: "CrewAI", count: "734" },
  { name: "Kiro CLI", count: "456" },
  { name: "Goose", count: "345" },
  { name: "Augment", count: "567" },
  { name: "Trae", count: "289" },
  { name: "Replit", count: "678" },
  { name: "Amp", count: "234" },
];

export default async function Home() {
  const [featured, recent, allArtifacts] = await Promise.all([
    getFeaturedArtifacts(),
    getRecentArtifacts(),
    getArtifacts(),
  ]);

  return (
    <div className="min-h-screen flex flex-col">
      <Navigation />

      {/* Hero */}
      <section className="container pt-20 pb-16 md:pt-28 md:pb-20">
        <h1
          className="text-[clamp(2.5rem,7vw,5.5rem)] font-bold leading-[0.95] tracking-[-0.04em] max-w-[18ch]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          The open directory
          <br />
          for agent artifacts
        </h1>

        <div className="mt-6 max-w-[56ch]">
          <p className="text-[1.125rem] md:text-[1.25rem] text-muted-foreground leading-relaxed">
            Skills, MCP servers, Cursor rules, n8n nodes, and more — automatically
            indexed from GitHub. Installable via{" "}
            <span
              className="text-foreground px-1 py-0.5 border border-border"
              style={{ fontFamily: "var(--font-mono)", fontSize: "0.875rem" }}
            >
              npx skills add
            </span>
            . Compatible with 38+ agent platforms.
          </p>
        </div>

        {/* Search placeholder that links to explore */}
        <div className="mt-10 max-w-2xl">
          <Link href="/explore">
            <div className="relative cursor-pointer">
              <div
                className="w-full bg-transparent border border-border px-4 py-3 text-[0.9375rem] text-muted-foreground/60"
                style={{ fontFamily: "var(--font-body)" }}
              >
                Search skills, MCP servers, Cursor rules, n8n nodes...
              </div>
              <span
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[0.6875rem] text-muted-foreground/50 border border-border px-1.5 py-0.5"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                /
              </span>
            </div>
          </Link>
        </div>
      </section>

      {/* Stats bar */}
      <section className="rule rule-bottom">
        <div className="container py-4">
          <div className="flex items-baseline gap-8 md:gap-12 overflow-x-auto">
            {stats.map((stat) => (
              <div key={stat.label} className="flex items-baseline gap-2 shrink-0">
                <span
                  className="text-[0.6875rem] tracking-[0.05em] uppercase text-muted-foreground"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {stat.label}
                </span>
                <span
                  className="text-[0.8125rem] text-foreground font-medium"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {stat.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Featured / Trending */}
      <section className="container py-20 md:py-28">
        <div className="flex items-baseline justify-between mb-10">
          <div>
            <h2
              className="text-[clamp(1.75rem,3.5vw,2.75rem)] font-bold tracking-[-0.03em] leading-[1.05]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Trending this week
            </h2>
            <p className="mt-3 text-[0.9375rem] text-muted-foreground max-w-[48ch]">
              Most starred and installed artifacts across the ecosystem, ranked by
              community activity.
            </p>
          </div>
          <Link href="/explore">
            <span
              className="text-[0.75rem] tracking-[0.02em] editorial-link hidden md:inline"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              View all
            </span>
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2">
          {featured.map((artifact: Artifact, i: number) => (
            <Link key={artifact.id} href={`/skill/${artifact.slug}`}>
              <div
                className={`group py-8 px-6 transition-colors duration-150 hover:bg-[oklch(0.96_0.005_80)] cursor-pointer border-border ${
                  i % 2 !== 0 ? "md:border-l" : ""
                } ${i >= 2 ? "border-t" : "border-b md:border-b-0"}`}
              >
                <div className="flex items-baseline gap-3 mb-2">
                  <span
                    className="text-[0.625rem] tracking-[0.06em] uppercase text-muted-foreground border border-border px-1.5 py-0.5"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {artifact.artifact_type?.label || "Skill"}
                  </span>
                  <span className="text-[0.625rem] text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
                    {formatNumber(artifact.stars)} stars
                  </span>
                  <span className="text-[0.625rem] text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
                    {formatNumber(artifact.weekly_downloads)} installs/wk
                  </span>
                </div>
                <h3
                  className="text-[1.25rem] font-semibold tracking-[-0.02em] mb-2 group-hover:text-[var(--color-vermillion)] transition-colors duration-150"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {artifact.name}
                </h3>
                <p className="text-[0.8125rem] text-muted-foreground leading-relaxed line-clamp-2 mb-4">
                  {artifact.description}
                </p>
                <div className="flex items-baseline gap-2">
                  <span className="text-[0.625rem] text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
                    @{artifact.contributor?.github_username || "Unknown"}
                  </span>
                  <span className="text-[0.625rem] text-muted-foreground">·</span>
                  <span className="text-[0.625rem] text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
                    {artifact.artifact_platforms?.length || 0} platforms
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="rule">
        <div className="container py-20 md:py-28">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-12 md:gap-8">
            <div className="md:col-span-4">
              <h2
                className="text-[clamp(1.75rem,3.5vw,2.75rem)] font-bold tracking-[-0.03em] leading-[1.05]"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Artifacts find
                <br />
                their way here
              </h2>
              <p className="mt-4 text-[0.9375rem] text-muted-foreground leading-relaxed max-w-[36ch]">
                No manual curation. Our pipeline discovers, indexes, and keeps
                artifacts fresh — automatically.
              </p>
            </div>
            <div className="md:col-span-8">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-0">
                {[
                  { num: "01", title: "Discovered", body: "Our pipeline scans GitHub topics, SKILL.md patterns, npm registries, and MCP server manifests every 6 hours for new agent artifacts." },
                  { num: "02", title: "Enriched", body: "Gemini Flash extracts metadata, generates descriptions, identifies compatible platforms, and categorizes each artifact. Cost: $0.002 per artifact." },
                  { num: "03", title: "Distributed", body: "Install any artifact via npx skills add. Each listing gets a unique SEO page, structured data, and llms.txt entry for AI discoverability." },
                ].map((step, i: number) => (
                  <div key={step.num} className={`py-6 sm:px-6 ${i > 0 ? "rule sm:border-t-0 sm:border-l sm:border-border" : ""}`}>
                    <span className="text-[0.6875rem] text-muted-foreground block mb-4" style={{ fontFamily: "var(--font-mono)" }}>
                      {step.num}
                    </span>
                    <h3 className="text-[1.125rem] font-semibold tracking-[-0.02em] mb-2" style={{ fontFamily: "var(--font-display)" }}>
                      {step.title}
                    </h3>
                    <p className="text-[0.8125rem] text-muted-foreground leading-relaxed">{step.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Recently Indexed */}
      <section className="rule">
        <div className="container py-10">
          <div className="flex items-baseline justify-between mb-2">
            <h2 className="text-[1.5rem] md:text-[1.75rem] font-bold tracking-[-0.03em]" style={{ fontFamily: "var(--font-display)" }}>
              Recently indexed
            </h2>
            <Link href="/explore">
              <span className="text-[0.75rem] tracking-[0.02em] editorial-link" style={{ fontFamily: "var(--font-mono)" }}>
                View all
              </span>
            </Link>
          </div>
        </div>

        <div className="rule">
          <div className="container py-2.5">
            <div className="grid grid-cols-12 gap-4 items-baseline">
              <div className="col-span-1 hidden lg:block">
                <span className="text-[0.625rem] tracking-[0.05em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>No.</span>
              </div>
              <div className="col-span-12 lg:col-span-5">
                <span className="text-[0.625rem] tracking-[0.05em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>Artifact</span>
              </div>
              <div className="col-span-2 hidden md:block">
                <span className="text-[0.625rem] tracking-[0.05em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>Tags</span>
              </div>
              <div className="col-span-4 hidden lg:flex justify-end">
                <span className="text-[0.625rem] tracking-[0.05em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>Meta</span>
              </div>
            </div>
          </div>
        </div>

        {recent.slice(0, 8).map((skill: Artifact, i: number) => (
          <SkillRow key={skill.id} skill={skill} index={i} />
        ))}

        <div className="rule">
          <div className="container py-6 text-center">
            <Link href="/explore">
              <span className="text-[0.8125rem] tracking-[0.02em] editorial-link" style={{ fontFamily: "var(--font-display)" }}>
                Browse all {allArtifacts.length} artifacts
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* Platforms section */}
      <section className="container py-20 md:py-28">
        <h2 className="text-[clamp(1.75rem,3.5vw,2.75rem)] font-bold tracking-[-0.03em] leading-[1.05] mb-4" style={{ fontFamily: "var(--font-display)" }}>
          38+ platforms,
          <br />
          one directory
        </h2>
        <p className="text-[0.9375rem] text-muted-foreground leading-relaxed max-w-[52ch] mb-12">
          We index artifacts from every major coding agent, automation platform,
          and AI framework. No more searching across dozens of registries.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5" style={{ border: "1px solid var(--color-rule)" }}>
          {platformData.map((platform) => (
            <div key={platform.name} className="py-5 px-4" style={{ outline: "0.5px solid var(--color-rule)" }}>
              <span className="text-[0.875rem] font-semibold tracking-[-0.01em] block mb-1" style={{ fontFamily: "var(--font-display)" }}>
                {platform.name}
              </span>
              <span className="text-[0.6875rem] text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
                {platform.count} artifacts
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Artifact Types */}
      <section className="rule">
        <div className="container py-20 md:py-28">
          <h2 className="text-[clamp(1.75rem,3.5vw,2.75rem)] font-bold tracking-[-0.03em] leading-[1.05] mb-4" style={{ fontFamily: "var(--font-display)" }}>
            Every artifact type
          </h2>
          <p className="text-[0.9375rem] text-muted-foreground leading-relaxed max-w-[48ch] mb-12">
            From executable skills to configuration rules, we index every kind of agent artifact in the ecosystem.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-0">
            {[
              { type: "Skills", count: "12,450", desc: "Executable instructions that teach agents how to perform specific tasks. Installed via npx skills add." },
              { type: "MCP Servers", count: "3,412", desc: "Model Context Protocol servers that give agents access to external tools, APIs, and data sources." },
              { type: "Cursor Rules", count: "3,847", desc: ".cursorrules files that enforce coding conventions, framework patterns, and project-specific guidelines." },
              { type: "n8n Nodes", count: "1,567", desc: "Community nodes for n8n that extend workflow automation with custom integrations and AI capabilities." },
            ].map((item, i: number) => (
              <div key={item.type} className={`py-8 ${i > 0 ? "sm:pl-6 border-t sm:border-t-0 sm:border-l border-border" : ""}`}>
                <span className="text-[0.6875rem] tracking-[0.06em] uppercase text-muted-foreground block mb-3" style={{ fontFamily: "var(--font-mono)" }}>
                  {item.count} indexed
                </span>
                <h3 className="text-[1.25rem] font-semibold tracking-[-0.02em] mb-2" style={{ fontFamily: "var(--font-display)" }}>{item.type}</h3>
                <p className="text-[0.8125rem] text-muted-foreground leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="rule rule-bottom">
        <div className="container py-20 md:py-28">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-start">
            <div>
              <h2 className="text-[clamp(1.75rem,3.5vw,2.75rem)] font-bold tracking-[-0.03em] leading-[1.05]" style={{ fontFamily: "var(--font-display)" }}>
                Add your artifact
                <br />
                to the directory
              </h2>
            </div>
            <div>
              <p className="text-[0.9375rem] text-muted-foreground leading-relaxed mb-6 max-w-[42ch]">
                Submit a GitHub repository URL or add the{" "}
                <span className="text-foreground px-1 py-0.5 border border-border" style={{ fontFamily: "var(--font-mono)", fontSize: "0.8125rem" }}>
                  oneskill
                </span>{" "}
                topic to your repo. Our pipeline handles the rest.
              </p>
              <div className="mb-6 p-4 border border-border bg-[oklch(0.96_0.005_80)]">
                <span className="text-[0.5625rem] tracking-[0.08em] uppercase text-muted-foreground block mb-2" style={{ fontFamily: "var(--font-mono)" }}>
                  Install any artifact
                </span>
                <code className="text-[0.8125rem] text-foreground" style={{ fontFamily: "var(--font-mono)" }}>
                  npx skills add author/repo --skill skill-name
                </code>
              </div>
              <Link href="/submit">
                <span className="inline-block text-[0.8125rem] tracking-[0.02em] px-5 py-2.5 bg-foreground text-background transition-opacity duration-150 hover:opacity-80" style={{ fontFamily: "var(--font-display)" }}>
                  Submit an artifact
                </span>
              </Link>
            </div>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
}
