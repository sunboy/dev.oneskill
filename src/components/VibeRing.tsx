import { vibeColor } from "@/lib/types";

interface VibeRingProps {
  score: number;
  size?: "sm" | "md" | "lg";
}

const SIZES = {
  sm: { w: "w-[2.5rem]", h: "h-[2.5rem]", font: "text-[0.625rem]" },
  md: { w: "w-[3rem]",   h: "h-[3rem]",   font: "text-[0.75rem]" },
  lg: { w: "w-[5.5rem]", h: "h-[5.5rem]", font: "text-[1.75rem]" },
};

export default function VibeRing({ score, size = "md" }: VibeRingProps) {
  const color = vibeColor(score);
  const s = SIZES[size];
  const dashArray = `${Math.max(0, Math.min(100, score))}, 100`;
  const strokeWidth = size === "lg" ? 4 : 3;

  return (
    <div className={`${s.w} ${s.h} relative shrink-0`}>
      <svg viewBox="0 0 36 36" className="w-full h-full" style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx="18" cy="18" r="15.915"
          fill="none"
          stroke="var(--color-muted)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx="18" cy="18" r="15.915"
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={dashArray}
          style={{ transition: "stroke-dashoffset 1s ease-out" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span
          className={`${s.font} font-semibold tracking-[-0.03em]`}
          style={{ fontFamily: "var(--font-mono)", color }}
        >
          {score}
        </span>
        {size === "lg" && (
          <span
            className="text-[0.5rem] uppercase tracking-[0.1em] text-muted-foreground mt-0.5"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            Vibe
          </span>
        )}
      </div>
    </div>
  );
}
