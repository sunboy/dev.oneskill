"use client";

import { toast } from "sonner";

interface CopyButtonProps {
  text: string;
  label: string;
  primary?: boolean;
  block?: boolean;
}

export default function CopyButton({ text, label, primary, block }: CopyButtonProps) {
  const copy = () => {
    navigator.clipboard.writeText(text);
    toast("Copied to clipboard");
  };

  if (block) {
    return (
      <button
        onClick={copy}
        className="w-full text-center text-[0.8125rem] tracking-[0.02em] px-5 py-2.5 border border-border text-foreground transition-colors duration-150 hover:border-foreground"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {label}
      </button>
    );
  }

  return (
    <button
      onClick={copy}
      className={`w-full text-left px-4 py-3 transition-colors duration-150 mb-2 ${
        primary
          ? "bg-[oklch(0.96_0.005_80)] border border-border hover:bg-[oklch(0.94_0.005_80)]"
          : "bg-transparent border border-border hover:bg-[oklch(0.96_0.005_80)]"
      }`}
    >
      <code
        className={`text-[0.8125rem] ${primary ? "text-foreground" : "text-muted-foreground"}`}
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {text}
      </code>
      <span
        className="float-right text-[0.625rem] text-muted-foreground mt-0.5"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {label}
      </span>
    </button>
  );
}
