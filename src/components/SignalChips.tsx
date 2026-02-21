import { formatNumber, VIBE_FLAGS, sentimentLabel } from "@/lib/types";
import type { Artifact } from "@/lib/types";

interface SignalChipsProps {
  artifact: Artifact;
  compact?: boolean; // for featured cards
}

export default function SignalChips({ artifact, compact = false }: SignalChipsProps) {
  const chips: React.ReactNode[] = [];

  // npm downloads
  if (VIBE_FLAGS.npm && artifact.npm_downloads_weekly > 0) {
    chips.push(
      <span key="npm" className="inline-flex items-center gap-1">
        <svg viewBox="0 0 16 16" className="w-3 h-3 opacity-60" fill="#cb3837">
          <rect x="1" y="5" width="14" height="8" rx="1"/>
          <rect x="3" y="7" width="3" height="4" fill="white"/>
          <rect x="7" y="7" width="3" height="4" fill="white"/>
          <rect x="8" y="7" width="1" height="2" fill="#cb3837"/>
        </svg>
        <span className="signal-val">{formatNumber(artifact.npm_downloads_weekly)}</span>
        {!compact && "/wk"}
      </span>
    );
  }

  // PyPI downloads
  if (VIBE_FLAGS.pypi && artifact.pypi_downloads_weekly > 0) {
    chips.push(
      <span key="pypi" className="inline-flex items-center gap-1">
        <svg viewBox="0 0 16 16" className="w-3 h-3 opacity-60" fill="#3775a9">
          <rect x="2" y="2" width="5" height="5" rx="1"/>
          <rect x="9" y="9" width="5" height="5" rx="1"/>
          <rect x="6" y="6" width="4" height="4" rx="1" opacity="0.5"/>
        </svg>
        <span className="signal-val">{formatNumber(artifact.pypi_downloads_weekly)}</span>
        {!compact && "/wk"}
      </span>
    );
  }

  // HN mentions
  if (VIBE_FLAGS.hackernews && artifact.mention_count_7d > 0) {
    chips.push(
      <span key="hn" className="inline-flex items-center gap-1">
        <svg viewBox="0 0 16 16" className="w-3 h-3 opacity-60">
          <polygon points="8,1 10,6 16,6 11,9.5 13,15 8,11.5 3,15 5,9.5 0,6 6,6" fill="#ff6600"/>
        </svg>
        <span className="signal-val">{artifact.mention_count_7d}</span>
        {!compact && <span className="text-muted-foreground">HN</span>}
      </span>
    );
  }

  // 30d mentions (Reddit/Dev.to combined) — show if 7d is empty but 30d has data
  if (artifact.mention_count_30d > 0 && artifact.mention_count_7d === 0) {
    chips.push(
      <span key="mentions" className="inline-flex items-center gap-1">
        <span className="signal-val">{artifact.mention_count_30d}</span>
        <span className="text-muted-foreground">mentions</span>
      </span>
    );
  }

  // Sentiment dot
  if (VIBE_FLAGS.sentiment && artifact.mention_count_30d > 0 && artifact.sentiment_avg !== 0) {
    const sent = sentimentLabel(artifact.sentiment_avg);
    const dotColor = sent === "positive" ? "oklch(0.65 0.2 145)" : sent === "negative" ? "oklch(0.60 0.2 25)" : "oklch(0.70 0.05 80)";
    chips.push(
      <span
        key="sentiment"
        className="inline-block w-1.5 h-1.5 rounded-full ml-0.5"
        style={{ background: dotColor }}
        title={`${Math.round(((artifact.sentiment_avg + 1) / 2) * 100)}% positive sentiment`}
      />
    );
  }

  if (chips.length === 0) return null;

  return (
    <div
      className="flex items-center gap-3 flex-wrap mt-1.5"
      style={{ fontFamily: "var(--font-mono)", fontSize: "0.6875rem", color: "var(--color-muted-foreground)" }}
    >
      {chips}
    </div>
  );
}
