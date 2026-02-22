import Link from "next/link";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import ArtifactCard from "@/components/ArtifactCard";
import { getCuratedArtifacts, getArtifacts, getRecentlyAdded, getCategories } from "@/lib/data";
import { artifactTypeLabels, formatNumber } from "@/lib/types";
import type { Artifact } from "@/lib/types";

export default async function Home() {
  const [curated, allArtifacts, recentlyAdded, categories] = await Promise.all([
    getCuratedArtifacts(6),
    getArtifacts(),
    getRecentlyAdded(6),
    getCategories(),
  ]);

  const trendingList = [...allArtifacts]
    .sort((a, b) => b.trending_score - a.trending_score)
    .slice(0, 6);

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

      {/* ── Category bar ─────────────────────────────── */}
      {categories.length > 0 && (
        <div className="rule">
          <div className="container py-3">
            <div className="flex items-center gap-3 overflow-x-auto no-scrollbar">
              <span
                className="text-[0.5625rem] tracking-[0.08em] uppercase text-muted-foreground shrink-0"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                Categories
              </span>
              <div className="flex gap-1.5">
                {categories.map((cat) => (
                  <Link key={cat.id} href="/explore">
                    <span
                      className="text-[0.6875rem] text-muted-foreground px-2.5 py-1 border border-border hover:border-foreground hover:text-foreground transition-colors duration-150 cursor-pointer whitespace-nowrap"
                      style={{ fontFamily: "var(--font-mono)" }}
                    >
                      {cat.label}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Curated Picks (card grid) ──────────────── */}
      {curated.length > 0 && (
        <section className="rule">
          <div className="container py-12 md:py-16">
            <SectionHeader title="Curated picks" subtitle="Standout artifacts chosen by the community and our team." href="/explore" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-0 artifact-grid">
              {curated.map((artifact: Artifact) => (
                <ArtifactCard key={artifact.id} artifact={artifact} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Trending (card grid) ───────────────────── */}
      <section className="rule">
        <div className="container py-12 md:py-16">
          <SectionHeader title="Trending" subtitle="Most popular artifacts this week by stars and community activity." href="/explore" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-0 artifact-grid">
            {trendingList.map((artifact: Artifact) => (
              <ArtifactCard key={artifact.id} artifact={artifact} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Recently Added (card grid) ─────────────── */}
      {recentlyAdded.length > 0 && (
        <section className="rule">
          <div className="container py-12 md:py-16">
            <SectionHeader title="Recently added" subtitle="New artifacts freshly indexed from GitHub." href="/explore" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-0 artifact-grid">
              {recentlyAdded.map((artifact: Artifact) => (
                <ArtifactCard key={artifact.id} artifact={artifact} />
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ── Browse all ─────────────────────────────── */}
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

/* ── Reusable section header ─────────────────────── */
function SectionHeader({ title, subtitle, href }: { title: string; subtitle: string; href: string }) {
  return (
    <div className="flex items-baseline justify-between mb-8">
      <div>
        <h2
          className="text-[clamp(1.25rem,2.5vw,1.75rem)] font-bold tracking-[-0.03em] leading-[1.1]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {title}
        </h2>
        <p className="mt-1.5 text-[0.8125rem] text-muted-foreground">
          {subtitle}
        </p>
      </div>
      <Link href={href}>
        <span
          className="text-[0.75rem] tracking-[0.02em] editorial-link hidden md:inline"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          View all →
        </span>
      </Link>
    </div>
  );
}
