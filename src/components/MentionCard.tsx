import type { ArtifactMention } from "@/lib/types";
import { MENTION_SOURCE_META, getTimeAgo } from "@/lib/types";

interface MentionCardProps {
  mention: ArtifactMention;
}

export default function MentionCard({ mention }: MentionCardProps) {
  const meta = MENTION_SOURCE_META[mention.source];
  const bgAlpha = `${meta.color}1a`;

  return (
    <a
      href={mention.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 py-3 border-b border-border last:border-b-0 transition-colors duration-150 hover:bg-[oklch(0.96_0.005_80)] -mx-2 px-2 group"
    >
      {/* Source icon */}
      <div
        className="w-7 h-7 flex items-center justify-center shrink-0 text-[0.75rem] font-bold"
        style={{
          fontFamily: "var(--font-display)",
          background: bgAlpha,
          color: meta.color,
          borderRadius: "var(--radius, 2px)",
        }}
      >
        {meta.shortLabel}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span
            className="text-[0.8125rem] font-medium truncate group-hover:text-[var(--color-vermillion)] transition-colors duration-150"
            style={{ fontFamily: "var(--font-display)" }}
          >
            {mention.title}
          </span>
          <span
            className="text-[0.625rem] text-muted-foreground shrink-0 flex items-center gap-1"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {mention.source === "devto" ? "♡" : "▲"} {mention.score}
          </span>
        </div>
        <div
          className="flex gap-3 mt-0.5 text-[0.625rem] text-muted-foreground"
          style={{ fontFamily: "var(--font-mono)" }}
        >
          <span>{meta.label}</span>
          {mention.comment_count > 0 && <span>{mention.comment_count} comments</span>}
          <span>{getTimeAgo(mention.mentioned_at)}</span>
        </div>
      </div>
    </a>
  );
}
