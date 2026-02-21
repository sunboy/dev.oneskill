import VibeRing from "./VibeRing";
import MentionCard from "./MentionCard";
import { vibeLabel, formatNumber } from "@/lib/types";
import type { Artifact, ArtifactMention } from "@/lib/types";

interface VibePanelProps {
  artifact: Artifact;
  mentions: ArtifactMention[];
}

// Reverse-engineer component scores from the vibe score formula
function computeComponents(a: Artifact) {
  const downloads = (a.npm_downloads_weekly || 0) + (a.pypi_downloads_weekly || 0);
  const downloadSignal = Math.min(30, Math.floor(Math.log10(Math.max(1, downloads)) * 8));

  const mentionSignal = Math.min(30, (a.mention_count_7d * 5) + (a.mention_count_30d * 1));

  // Approximate quality from mentions/score — we don't have raw avgScore on frontend,
  // so we estimate from mention_count and sentiment
  const qualitySignal = Math.min(20, Math.floor(Math.log10(Math.max(1, a.mention_count_30d * 10)) * 10));

  const sentimentSignal = Math.round(((a.sentiment_avg || 0) + 1) * 5);

  const recencySignal = a.mention_count_7d > 0 ? 10 : a.mention_count_30d > 0 ? 5 : 0;

  return [
    { label: "Downloads", value: downloadSignal, max: 30, color: "#cb3837" },
    { label: "Mentions",  value: mentionSignal,  max: 30, color: "oklch(0.58 0.22 25)" },
    { label: "Quality",   value: qualitySignal,  max: 20, color: "oklch(0.65 0.18 55)" },
    { label: "Sentiment", value: sentimentSignal, max: 10, color: "oklch(0.65 0.2 145)" },
    { label: "Recency",   value: recencySignal,  max: 10, color: "oklch(0.58 0.22 25)" },
  ];
}

export default function VibePanel({ artifact, mentions }: VibePanelProps) {
  const components = computeComponents(artifact);
  const label = vibeLabel(artifact.vibe_score);
  const hasMentions = mentions.length > 0;
  const hasAnySignal = artifact.vibe_score > 0 || artifact.npm_downloads_weekly > 0 || artifact.pypi_downloads_weekly > 0;

  if (!hasAnySignal) return null;

  return (
    <div className="border border-border" style={{ borderRadius: "var(--radius, 2px)" }}>
      <div className="p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <span
            className="text-[0.8125rem] font-semibold uppercase tracking-[-0.01em]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Vibe Score
          </span>
        </div>

        {/* Hero score + breakdown label */}
        <div className="flex items-center gap-5 mb-5 pb-5 border-b border-border">
          <VibeRing score={artifact.vibe_score} size="lg" />
          <div className="flex-1">
            <h3
              className="text-[1rem] font-semibold tracking-[-0.02em]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {label}
            </h3>
            <p className="text-[0.8125rem] text-muted-foreground leading-snug mt-0.5">
              {artifact.mention_count_30d > 0
                ? `${artifact.mention_count_30d} social mentions in 30 days${artifact.sentiment_avg > 0.2 ? `, ${Math.round(((artifact.sentiment_avg + 1) / 2) * 100)}% positive` : ""}.`
                : artifact.npm_downloads_weekly > 0 || artifact.pypi_downloads_weekly > 0
                  ? `${formatNumber((artifact.npm_downloads_weekly || 0) + (artifact.pypi_downloads_weekly || 0))} weekly installs.`
                  : "Tracking community signals."}
            </p>
          </div>
        </div>

        {/* Signal bars */}
        <div className="flex flex-col gap-3 mb-5 pb-5 border-b border-border">
          {components.map((c) => (
            <div key={c.label} className="flex items-center gap-3">
              <span
                className="text-[0.6875rem] text-muted-foreground w-[5rem] text-right shrink-0"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {c.label}
              </span>
              <div className="flex-1 h-1 bg-[var(--color-muted)] rounded-sm overflow-hidden">
                <div
                  className="h-full rounded-sm"
                  style={{
                    width: `${(c.value / c.max) * 100}%`,
                    background: c.color,
                    transition: "width 0.8s ease-out",
                  }}
                />
              </div>
              <span
                className="text-[0.6875rem] font-medium w-[2.5rem] text-right shrink-0"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {c.value}/{c.max}
              </span>
            </div>
          ))}
        </div>

        {/* Social mentions */}
        {hasMentions && (
          <div>
            <div className="flex justify-between items-center mb-2">
              <span
                className="text-[0.8125rem] font-semibold"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Social Mentions
              </span>
              <span
                className="text-[0.625rem] text-muted-foreground"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {artifact.mention_count_30d} in 30d
              </span>
            </div>
            {mentions.slice(0, 5).map((m) => (
              <MentionCard key={m.id} mention={m} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
