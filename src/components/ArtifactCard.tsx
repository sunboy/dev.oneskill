import Link from "next/link";
import type { Artifact } from "@/lib/types";
import { formatNumber } from "@/lib/types";

interface ArtifactCardProps {
  artifact: Artifact;
  showCategory?: boolean;
}

export default function ArtifactCard({ artifact, showCategory = true }: ArtifactCardProps) {
  const hasVibe = artifact.vibe_score > 0;

  return (
    <Link href={`/skill/${artifact.slug}`}>
      <div className="group artifact-card h-full flex flex-col p-5 cursor-pointer transition-colors duration-150 hover:bg-[oklch(0.96_0.005_80)]">
        {/* Top row: avatar + type + stars */}
        <div className="flex items-center gap-3 mb-3">
          {artifact.contributor?.avatar_url ? (
            <img
              src={artifact.contributor.avatar_url}
              alt={artifact.contributor.github_username}
              className="w-8 h-8 rounded-full object-cover shrink-0 border border-border"
            />
          ) : (
            <div
              className="w-8 h-8 rounded-full bg-[oklch(0.93_0.005_80)] border border-border shrink-0 flex items-center justify-center"
            >
              <span
                className="text-[0.5rem] text-muted-foreground"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {artifact.name.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
          <div className="flex items-baseline gap-2 flex-1 min-w-0">
            <span
              className="text-[0.5625rem] tracking-[0.06em] uppercase text-muted-foreground border border-border px-1.5 py-0.5"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {artifact.artifact_type?.label || "Skill"}
            </span>
          </div>
          <span
            className="text-[0.6875rem] text-muted-foreground shrink-0"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {formatNumber(artifact.stars)} ★
          </span>
        </div>

        {/* Name */}
        <h3
          className="text-[1rem] font-semibold tracking-[-0.02em] mb-1.5 group-hover:text-[var(--color-vermillion)] transition-colors duration-150 leading-snug"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {artifact.name}
        </h3>

        {/* Description */}
        <p className="text-[0.8125rem] text-muted-foreground leading-relaxed line-clamp-2 mb-4 flex-1">
          {artifact.description}
        </p>

        {/* Bottom row: category + vibe + author */}
        <div className="flex items-center gap-2 flex-wrap mt-auto">
          {showCategory && artifact.category && (
            <span
              className="text-[0.5625rem] tracking-[0.04em] text-muted-foreground px-2 py-0.5 bg-[oklch(0.93_0.005_80)] rounded-sm"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              {artifact.category.label}
            </span>
          )}
          {hasVibe && (
            <span
              className="text-[0.5625rem] text-muted-foreground"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              vibe {artifact.vibe_score}
            </span>
          )}
          <span className="flex-1" />
          <span
            className="text-[0.5625rem] text-muted-foreground"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            @{artifact.contributor?.github_username || "—"}
          </span>
        </div>
      </div>
    </Link>
  );
}
