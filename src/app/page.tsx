import Link from "next/link";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { getCuratedArtifacts, getArtifacts } from "@/lib/data";
import { artifactTypeLabels, formatNumber } from "@/lib/types";
import type { Artifact } from "@/lib/types";

export default async function Home() {
  const [curated, allArtifacts] = await Promise.all([
    getCuratedArtifacts(6),
    getArtifacts(),
  ]);

  const trendingList = [...allArtifacts]
    .sort((a, b) => b.trending_score - a.trending_score)
    .slice(0, 8);

  return (
    <div className="min-h-screen flex flex-col">
      <Navigation />

      {/* ── Hero: Search-forward ─────────────────────── */}
      <section className="container pt-16 pb-12 md:pt-24 md:pb-16 text-center">
        <h1
          className="text-[clamp(2rem,5vw,3.5rem)] font-bold leading-[1.05] tracking-[-0.04em] mx-auto max-w-[20ch]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Find the right artifact
          <br />
          for your agent
        </h1>

        <p className="mt-4 text-[1rem] text-muted-foreground leading-relaxed max-w-[46ch] mx-auto">
          Skills, MCP servers, Cursor rules, and more — indexed from GitHub,
          installable in one command.
        </p>

        {/* Search links to /explore */}
        <div className="mt-8 max-w-xl mx-auto">
          <Link href="/explore">
            <div className="relative cursor-pointer">
              <div
                className="w-full border border-border px-5 py-3.5 text-[0.9375rem] text-muted-foreground/50 text-left"
                style={{ fontFamily: "var(--font-body)" }}
              >
                Search {allArtifacts.length > 0 ? `${allArtifacts.length.toLocaleString()}+` : ""} artifacts...
              </div>
              <span
                className="absolute right-4 top-1/2 -translate-y-1/2 text-[0.625rem] text-muted-foreground/40 border border-border px-1.5 py-0.5"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                /
              </span>
            </div>
          </Link>
        </div>

        {/* Type pills */}
        <div className="mt-4 flex justify-center gap-2 flex-wrap">
          {(["skill", "mcp-server", "cursor-rules", "n8n-node", "workflow", "langchain-tool", "crewai-tool"] as const).map((type) => (
            <Link key={type} href="/explore">
              <span
                className="text-[0.6875rem] text-muted-foreground px-2.5 py-1 border border-border hover:border-foreground hover:text-foreground transition-colors duration-150 cursor-pointer"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {artifactTypeLabels[type]}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Curated Picks ────────────────────────────── */}
      {curated.length > 0 && (
        <section className="rule">
          <div className="container py-12 md:py-16">
            <div className="flex items-baseline justify-between mb-8">
              <div>
                <h2
                  className="text-[clamp(1.25rem,2.5vw,1.75rem)] font-bold tracking-[-0.03em] leading-[1.1]"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  Curated picks
                </h2>
                <p className="mt-1.5 text-[0.8125rem] text-muted-foreground">
                  Standout artifacts chosen by the community and our team.
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

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-0 curated-grid">
              {curated.map((artifact: Artifact, i: number) => {
                const hasVibe = artifact.vibe_score > 0;
                return (
                  <Link key={artifact.id} href={`/skill/${artifact.slug}`}>
                    <div className="group curated-card py-6 px-5 cursor-pointer transition-colors duration-150 hover:bg-[oklch(0.96_0.005_80)] h-full">
                      <div className="flex items-baseline gap-2 mb-2">
                        <span
                          className="text-[0.5625rem] tracking-[0.06em] uppercase text-muted-foreground border border-border px-1.5 py-0.5"
                          style={{ fontFamily: "var(--font-mono)" }}
                        >
                          {artifact.artifact_type?.label || "Skill"}
                        </span>
                        <span
                          className="text-[0.5625rem] text-muted-foreground"
                          style={{ fontFamily: "var(--font-mono)" }}
                        >
                          {formatNumber(artifact.stars)} ★
                        </span>
                        {hasVibe && (
                          <span
                            className="text-[0.5625rem] text-muted-foreground"
                            style={{ fontFamily: "var(--font-mono)" }}
                          >
                            vibe {artifact.vibe_score}
                          </span>
                        )}
                      </div>
                      <h3
                        className="text-[1.0625rem] font-semibold tracking-[-0.02em] mb-1.5 group-hover:text-[var(--color-vermillion)] transition-colors duration-150"
                        style={{ fontFamily: "var(--font-display)" }}
                      >
                        {artifact.name}
                      </h3>
                      <p className="text-[0.8125rem] text-muted-foreground leading-relaxed line-clamp-2 mb-3">
                        {artifact.description}
                      </p>
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span
                          className="text-[0.5625rem] text-muted-foreground"
                          style={{ fontFamily: "var(--font-mono)" }}
                        >
                          @{artifact.contributor?.github_username || "—"}
                        </span>
                        {artifact.artifact_platforms && artifact.artifact_platforms.length > 0 && (
                          <>
                            <span className="text-[0.5625rem] text-muted-foreground">·</span>
                            <span
                              className="text-[0.5625rem] text-muted-foreground"
                              style={{ fontFamily: "var(--font-mono)" }}
                            >
                              {artifact.artifact_platforms[0]?.platform?.label}
                              {artifact.artifact_platforms.length > 1
                                ? ` +${artifact.artifact_platforms.length - 1}`
                                : ""}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* ── Trending List ────────────────────────────── */}
      <section className="rule">
        <div className="container py-3">
          <div className="flex items-baseline justify-between">
            <h2
              className="text-[0.625rem] tracking-[0.08em] uppercase text-muted-foreground"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Trending
            </h2>
            <Link href="/explore">
              <span
                className="text-[0.625rem] tracking-[0.02em] editorial-link"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                View all
              </span>
            </Link>
          </div>
        </div>

        {trendingList.map((artifact: Artifact, i: number) => (
          <Link key={artifact.id} href={`/skill/${artifact.slug}`}>
            <div className="rule group cursor-pointer transition-colors duration-150 hover:bg-[oklch(0.96_0.005_80)]">
              <div className="container py-3.5">
                <div className="flex items-baseline gap-4">
                  {/* Rank */}
                  <span
                    className="text-[0.6875rem] text-muted-foreground w-6 shrink-0 hidden sm:inline"
                    style={{ fontFamily: "var(--font-mono)" }}
                  >
                    {String(i + 1).padStart(2, "0")}
                  </span>

                  {/* Name + type */}
                  <div className="flex items-baseline gap-2 min-w-0 flex-1">
                    <h3
                      className="text-[0.9375rem] font-semibold tracking-[-0.02em] group-hover:text-[var(--color-vermillion)] transition-colors duration-150 truncate"
                      style={{ fontFamily: "var(--font-display)" }}
                    >
                      {artifact.name}
                    </h3>
                    <span
                      className="text-[0.5rem] tracking-[0.06em] uppercase text-muted-foreground border border-border px-1 py-0.5 shrink-0"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {artifact.artifact_type?.label || "Skill"}
                    </span>
                  </div>

                  {/* Meta */}
                  <div className="flex items-baseline gap-4 shrink-0">
                    {artifact.artifact_platforms && artifact.artifact_platforms.length > 0 && (
                      <span
                        className="text-[0.6875rem] text-muted-foreground hidden md:inline"
                        style={{ fontFamily: "var(--font-mono)" }}
                      >
                        {artifact.artifact_platforms[0]?.platform?.label}
                        {artifact.artifact_platforms.length > 1
                          ? ` +${artifact.artifact_platforms.length - 1}`
                          : ""}
                      </span>
                    )}
                    <span
                      className="text-[0.6875rem] text-foreground font-medium"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {formatNumber(artifact.stars)} ★
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </Link>
        ))}

        {/* Browse all */}
        <div className="rule">
          <div className="container py-5 text-center">
            <Link href="/explore">
              <span
                className="text-[0.8125rem] tracking-[0.02em] editorial-link"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Browse all {allArtifacts.length > 0 ? allArtifacts.length.toLocaleString() : ""} artifacts →
              </span>
            </Link>
          </div>
        </div>
      </section>

      {/* ── CTA Strip ────────────────────────────────── */}
      <section className="rule-bottom">
        <div className="container py-12 md:py-16">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <h2
              className="text-[clamp(1.25rem,2.5vw,1.75rem)] font-bold tracking-[-0.03em]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Add your artifact to the directory
            </h2>
            <div className="flex items-center gap-3 flex-wrap">
              <code
                className="text-[0.8125rem] text-muted-foreground px-3 py-2 border border-border"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                npx skills add author/repo
              </code>
              <Link href="/submit">
                <span
                  className="inline-block text-[0.8125rem] tracking-[0.02em] px-5 py-2.5 bg-foreground text-background transition-opacity duration-150 hover:opacity-80"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  Submit →
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
