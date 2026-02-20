import Link from "next/link";
import { notFound } from "next/navigation";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { getArtifactById } from "@/lib/data";
import { artifactTypeLabels, formatNumber, getTimeAgo } from "@/lib/types";
import CopyButton from "./CopyButton";

export default async function SkillDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const artifact = await getArtifactById(id);
  if (!artifact) notFound();

  return (
    <div className="min-h-screen flex flex-col">
      <Navigation />

      {/* Breadcrumb */}
      <div className="rule-bottom">
        <div className="container py-3">
          <div className="flex items-baseline gap-2 flex-wrap">
            <Link href="/explore">
              <span className="text-[0.6875rem] text-muted-foreground editorial-link" style={{ fontFamily: "var(--font-mono)" }}>Explore</span>
            </Link>
            <span className="text-[0.6875rem] text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>/</span>
            <span className="text-[0.6875rem] text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>{artifactTypeLabels[artifact.artifact_type]}</span>
            <span className="text-[0.6875rem] text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>/</span>
            <span className="text-[0.6875rem] text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>{artifact.category}</span>
            <span className="text-[0.6875rem] text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>/</span>
            <span className="text-[0.6875rem] text-foreground" style={{ fontFamily: "var(--font-mono)" }}>{artifact.name}</span>
          </div>
        </div>
      </div>

      <div className="container py-12 md:py-16 flex-1">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-16">
          {/* Main content */}
          <div className="lg:col-span-8">
            <div className="flex items-baseline gap-3 mb-2 flex-wrap">
              <h1 className="text-[clamp(1.75rem,3.5vw,2.75rem)] font-bold tracking-[-0.03em] leading-[1.05]" style={{ fontFamily: "var(--font-display)" }}>
                {artifact.name}
              </h1>
              <span className="text-[0.625rem] tracking-[0.05em] uppercase text-muted-foreground border border-border px-1.5 py-0.5 shrink-0" style={{ fontFamily: "var(--font-mono)" }}>
                {artifactTypeLabels[artifact.artifact_type]}
              </span>
              {artifact.verified && (
                <span className="text-[0.625rem] tracking-[0.05em] uppercase text-muted-foreground border border-border px-1.5 py-0.5 shrink-0" style={{ fontFamily: "var(--font-mono)" }}>
                  verified
                </span>
              )}
            </div>

            <p className="text-[1.0625rem] text-muted-foreground leading-relaxed max-w-[60ch] mb-8">
              {artifact.long_description}
            </p>

            {/* Install commands */}
            <div className="mb-10">
              <span className="text-[0.625rem] tracking-[0.08em] uppercase text-muted-foreground block mb-2" style={{ fontFamily: "var(--font-mono)" }}>Install</span>
              <CopyButton text={artifact.install_command} label="click to copy" primary />
              {artifact.npx_skills_command && artifact.npx_skills_command !== artifact.install_command && (
                <CopyButton text={artifact.npx_skills_command} label="via npx skills" />
              )}
            </div>

            {/* Compatible Platforms */}
            <div className="mb-10">
              <span className="text-[0.625rem] tracking-[0.08em] uppercase text-muted-foreground block mb-3" style={{ fontFamily: "var(--font-mono)" }}>
                Compatible with {artifact.compatible_platforms.length} platforms
              </span>
              <div className="flex flex-wrap gap-2">
                {artifact.compatible_platforms.map((platform: string) => (
                  <span key={platform} className="text-[0.6875rem] tracking-[0.02em] text-muted-foreground px-2 py-1 border border-border" style={{ fontFamily: "var(--font-mono)" }}>
                    {platform}
                  </span>
                ))}
              </div>
            </div>

            {/* Tags */}
            <div className="mb-10">
              <span className="text-[0.625rem] tracking-[0.08em] uppercase text-muted-foreground block mb-3" style={{ fontFamily: "var(--font-mono)" }}>Tags</span>
              <div className="flex flex-wrap gap-2">
                {artifact.tags.map((tag: string) => (
                  <span key={tag} className="text-[0.6875rem] tracking-[0.02em] text-muted-foreground px-2 py-1 border border-border hover:border-foreground hover:text-foreground transition-colors duration-150 cursor-pointer" style={{ fontFamily: "var(--font-mono)" }}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* README */}
            <div className="rule pt-8">
              <span className="text-[0.625rem] tracking-[0.08em] uppercase text-muted-foreground block mb-4" style={{ fontFamily: "var(--font-mono)" }}>README.md</span>
              <div className="prose prose-sm max-w-none">
                <p className="text-[0.9375rem] leading-relaxed text-foreground whitespace-pre-line">{artifact.readme}</p>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <aside className="lg:col-span-4">
            <div className="lg:sticky lg:top-[80px]">
              <div className="mb-8">
                <span className="text-[0.625rem] tracking-[0.08em] uppercase text-muted-foreground block mb-2" style={{ fontFamily: "var(--font-mono)" }}>Author</span>
                <span className="text-[0.9375rem] font-semibold tracking-[-0.01em]" style={{ fontFamily: "var(--font-display)" }}>
                  {artifact.author}
                </span>
                <span className="block text-[0.75rem] text-muted-foreground mt-0.5" style={{ fontFamily: "var(--font-mono)" }}>
                  @{artifact.author_github}
                </span>
              </div>
              <div className="rule" />
              <div className="py-6 grid grid-cols-2 gap-y-5 gap-x-4">
                {[
                  { label: "Type", value: artifactTypeLabels[artifact.artifact_type] },
                  { label: "Stars", value: formatNumber(artifact.stars) },
                  { label: "Forks", value: formatNumber(artifact.forks) },
                  { label: "Weekly DL", value: formatNumber(artifact.weekly_downloads) },
                  { label: "Version", value: artifact.version },
                  { label: "License", value: artifact.license },
                  { label: "Updated", value: getTimeAgo(artifact.last_updated) },
                  { label: "Language", value: artifact.language },
                  { label: "Platforms", value: String(artifact.compatible_platforms.length) },
                  { label: "Trending", value: String(artifact.trending_score) + "/100" },
                ].map((item) => (
                  <div key={item.label}>
                    <span className="text-[0.5625rem] tracking-[0.08em] uppercase text-muted-foreground block mb-0.5" style={{ fontFamily: "var(--font-mono)" }}>{item.label}</span>
                    <span className="text-[0.8125rem] text-foreground" style={{ fontFamily: "var(--font-mono)" }}>{item.value}</span>
                  </div>
                ))}
              </div>
              <div className="rule" />
              <div className="py-6 flex flex-col gap-3">
                <a href={artifact.github_url} target="_blank" rel="noopener noreferrer" className="block text-center text-[0.8125rem] tracking-[0.02em] px-5 py-2.5 bg-foreground text-background transition-opacity duration-150 hover:opacity-80" style={{ fontFamily: "var(--font-display)" }}>
                  View on GitHub
                </a>
                <CopyButton text={artifact.install_command} label="Copy install command" block />
              </div>
            </div>
          </aside>
        </div>
      </div>

      <Footer />
    </div>
  );
}
