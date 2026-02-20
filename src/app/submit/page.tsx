"use client";

import { useState } from "react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { toast } from "sonner";

export default function Submit() {
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url) return;
    setSubmitting(true);

    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      if (res.ok) {
        toast.success("Artifact submitted! It will be indexed within 6 hours.");
        setUrl("");
      } else {
        toast.error("Submission failed. Please try again.");
      }
    } catch {
      toast.error("Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col">
      <Navigation />

      <div className="container py-20 md:py-28 flex-1">
        <div className="max-w-2xl">
          <h1
            className="text-[clamp(2rem,4vw,3.25rem)] font-bold tracking-[-0.04em] leading-[1]"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Submit an artifact
          </h1>
          <p className="mt-4 text-[0.9375rem] text-muted-foreground leading-relaxed max-w-[48ch]">
            Submit a GitHub repository URL containing an agent artifact. Our pipeline
            will automatically extract metadata, detect compatible platforms, and create
            a listing in the directory.
          </p>

          <form onSubmit={handleSubmit} className="mt-10">
            <div className="mb-6">
              <label className="text-[0.625rem] tracking-[0.08em] uppercase text-muted-foreground block mb-2" style={{ fontFamily: "var(--font-mono)" }}>
                GitHub Repository URL
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/username/repo"
                className="w-full bg-transparent border border-border px-4 py-3 text-[0.9375rem] placeholder:text-muted-foreground/50 focus:outline-none focus:border-foreground transition-colors duration-150"
                style={{ fontFamily: "var(--font-body)" }}
                required
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="text-[0.8125rem] tracking-[0.02em] px-6 py-2.5 bg-foreground text-background transition-opacity duration-150 hover:opacity-80 disabled:opacity-50"
              style={{ fontFamily: "var(--font-display)" }}
            >
              {submitting ? "Submitting..." : "Submit for indexing"}
            </button>
          </form>

          <div className="mt-16 rule pt-8">
            <h2 className="text-[1.25rem] font-semibold tracking-[-0.02em] mb-4" style={{ fontFamily: "var(--font-display)" }}>
              How it works
            </h2>
            <div className="space-y-4">
              {[
                { num: "01", text: "Submit any public GitHub repository URL" },
                { num: "02", text: "Our pipeline scans for SKILL.md, MCP configs, .cursorrules, and other artifact patterns" },
                { num: "03", text: "Gemini Flash extracts metadata and generates descriptions" },
                { num: "04", text: "Your artifact appears in the directory within 6 hours" },
              ].map((step) => (
                <div key={step.num} className="flex items-baseline gap-4">
                  <span className="text-[0.6875rem] text-muted-foreground shrink-0" style={{ fontFamily: "var(--font-mono)" }}>
                    {step.num}
                  </span>
                  <p className="text-[0.875rem] text-muted-foreground">{step.text}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-12 p-6 border border-border">
            <span className="text-[0.625rem] tracking-[0.08em] uppercase text-muted-foreground block mb-2" style={{ fontFamily: "var(--font-mono)" }}>
              Alternative
            </span>
            <p className="text-[0.875rem] text-muted-foreground leading-relaxed">
              Add the <span className="text-foreground px-1 py-0.5 border border-border" style={{ fontFamily: "var(--font-mono)", fontSize: "0.8125rem" }}>oneskill</span> topic
              to your GitHub repository. Our crawler automatically discovers repos with this topic every 6 hours.
            </p>
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}
