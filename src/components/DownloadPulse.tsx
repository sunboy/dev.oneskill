import { formatNumber } from "@/lib/types";

interface DownloadPulseProps {
  downloads: number;
}

export default function DownloadPulse({ downloads }: DownloadPulseProps) {
  if (downloads <= 0) return null;

  return (
    <div className="flex items-center gap-1.5">
      <div className="flex items-end gap-px h-3">
        {[40, 70, 100, 55, 85].map((h, i) => (
          <div
            key={i}
            className="w-0.5 rounded-sm"
            style={{
              height: `${h}%`,
              background: "var(--color-vermillion)",
              animation: `pulse-wave 1.5s ease-in-out infinite`,
              animationDelay: `${i * 0.15}s`,
            }}
          />
        ))}
      </div>
      <span
        className="text-[0.625rem] text-muted-foreground"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {formatNumber(downloads)}/wk
      </span>
    </div>
  );
}
