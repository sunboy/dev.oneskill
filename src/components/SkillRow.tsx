import Link from "next/link";
import type { Artifact } from "@/lib/types";
import { artifactTypeLabels, formatNumber, getTimeAgo } from "@/lib/types";
import VibeRing from "./VibeRing";
import SignalChips from "./SignalChips";

interface SkillRowProps {
  skill: Artifact;
  index?: number;
  showVibe?: boolean;
}

export default function SkillRow({ skill, index, showVibe = true }: SkillRowProps) {
  const hasVibe = showVibe && (skill.vibe_score > 0 || skill.npm_downloads_weekly > 0 || skill.pypi_downloads_weekly > 0);

  return (
    <Link href={`/skill/${skill.slug}`}>
      <div className="rule group py-5 cursor-pointer transition-colors duration-150 hover:bg-[oklch(0.96_0.005_80)]">
        <div className="container">
          <div className="grid grid-cols-12 gap-4 items-start">
            {/* Vibe ring or index number */}
            <div className="col-span-1 hidden lg:flex items-start pt-0.5">
              {hasVibe ? (
                <VibeRing score={skill.vibe_score} size="md" />
              ) : index !== undefined ? (
                <span
                  className="text-[0.6875rem] text-muted-foreground"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {String(index + 1).padStart(2, "0")}
                </span>
              ) : null}
            </div>

            {/* Name, description, signal chips */}
            <div className="col-span-12 lg:col-span-5">
              <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                <h3
                  className="text-[1rem] font-semibold tracking-[-0.02em] group-hover:text-[var(--color-vermillion)] transition-colors duration-150"
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {skill.name}
                </h3>
                <span
                  className="text-[0.5625rem] tracking-[0.06em] uppercase text-muted-foreground border border-border px-1.5 py-0.5 shrink-0"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {skill.artifact_type?.label || "Skill"}
                </span>
              </div>
              <p className="text-[0.8125rem] text-muted-foreground leading-snug line-clamp-1">
                {skill.description}
              </p>
              {/* Signal chips */}
              <SignalChips artifact={skill} />
            </div>

            {/* Tags */}
            <div className="col-span-6 lg:col-span-2 hidden md:flex items-baseline gap-1.5 flex-wrap">
              {skill.tags.slice(0, 3).map((tag: string) => (
                <span
                  key={tag}
                  className="text-[0.625rem] tracking-[0.03em] text-muted-foreground px-1.5 py-0.5 border border-border"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {tag}
                </span>
              ))}
            </div>

            {/* Meta: stars, time */}
            <div className="col-span-6 lg:col-span-4 flex items-baseline justify-end gap-6">
              {skill.artifact_platforms && skill.artifact_platforms.length > 0 && (
                <span
                  className="text-[0.6875rem] text-muted-foreground hidden sm:inline"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {skill.artifact_platforms[0]?.platform?.label}{skill.artifact_platforms.length > 1 ? ` +${skill.artifact_platforms.length - 1}` : ""}
                </span>
              )}
              <span
                className="text-[0.6875rem] text-muted-foreground"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {formatNumber(skill.stars)} stars
              </span>
              <span
                className="text-[0.6875rem] text-muted-foreground hidden sm:inline"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {getTimeAgo(skill.github_updated_at)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
