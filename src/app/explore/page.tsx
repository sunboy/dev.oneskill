"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import SkillRow from "@/components/SkillRow";
import { mockArtifacts } from "@/lib/data";
import { categories, platforms, artifactTypes, artifactTypeLabels, type ArtifactType } from "@/lib/types";
import type { Artifact } from "@/lib/types";
import { supabase } from "@/lib/supabase";

type SortOption = "stars" | "updated" | "downloads" | "trending" | "name";

export default function Explore() {
  const [artifacts, setArtifacts] = useState<Artifact[]>(mockArtifacts);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [activePlatform, setActivePlatform] = useState("All");
  const [activeType, setActiveType] = useState<ArtifactType | "all">("all");
  const [sortBy, setSortBy] = useState<SortOption>("trending");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function fetchArtifacts() {
      try {
        const { data, error } = await supabase
          .from("artifacts")
          .select("*")
          .order("trending_score", { ascending: false });
        if (!error && data && data.length > 0) {
          setArtifacts(data as Artifact[]);
        }
      } catch {
        // Keep mock data
      }
    }
    fetchArtifacts();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const filtered = useMemo(() => {
    let result = artifacts;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          s.tags.some((t: string) => t.toLowerCase().includes(q))
      );
    }
    if (activeCategory !== "All") result = result.filter((s) => s.category === activeCategory);
    if (activePlatform !== "All") result = result.filter((s) => s.compatible_platforms.includes(activePlatform));
    if (activeType !== "all") result = result.filter((s) => s.artifact_type === activeType);

    switch (sortBy) {
      case "stars": result = [...result].sort((a, b) => b.stars - a.stars); break;
      case "updated": result = [...result].sort((a, b) => new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime()); break;
      case "downloads": result = [...result].sort((a, b) => b.weekly_downloads - a.weekly_downloads); break;
      case "trending": result = [...result].sort((a, b) => b.trending_score - a.trending_score); break;
      case "name": result = [...result].sort((a, b) => a.name.localeCompare(b.name)); break;
    }
    return result;
  }, [artifacts, searchQuery, activeCategory, activePlatform, activeType, sortBy]);

  const hasActiveFilters = activeCategory !== "All" || activePlatform !== "All" || activeType !== "all";

  return (
    <div className="min-h-screen flex flex-col">
      <Navigation />
      <div className="container pt-12 pb-8">
        <h1 className="text-[clamp(2rem,4vw,3.25rem)] font-bold tracking-[-0.04em] leading-[1]" style={{ fontFamily: "var(--font-display)" }}>
          Explore
        </h1>
        <p className="mt-3 text-[0.9375rem] text-muted-foreground max-w-[56ch]">
          Browse the full directory of agent artifacts — skills, MCP servers, Cursor rules, n8n nodes, and more.
        </p>
      </div>

      {/* Search bar */}
      <div className="rule">
        <div className="container py-5">
          <div className="relative max-w-xl">
            <input
              ref={inputRef}
              type="text"
              placeholder="Search artifacts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-transparent border border-border px-4 py-2.5 text-[0.875rem] placeholder:text-muted-foreground/50 focus:outline-none focus:border-foreground transition-colors duration-150"
              style={{ fontFamily: "var(--font-body)" }}
            />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[0.625rem] text-muted-foreground/40 border border-border px-1.5 py-0.5" style={{ fontFamily: "var(--font-mono)" }}>
              /
            </span>
          </div>
        </div>
      </div>

      {/* Filter: Type */}
      <div className="rule">
        <div className="container py-4">
          <div className="flex items-baseline gap-6">
            <span className="text-[0.5625rem] tracking-[0.1em] uppercase text-muted-foreground shrink-0" style={{ fontFamily: "var(--font-mono)" }}>Type</span>
            <div className="flex items-baseline gap-1 flex-wrap">
              <button
                onClick={() => setActiveType("all")}
                className={`text-[0.75rem] px-2.5 py-1 border transition-all duration-150 ${activeType === "all" ? "border-foreground text-foreground bg-foreground/[0.04]" : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"}`}
                style={{ fontFamily: "var(--font-display)" }}
              >
                All
              </button>
              {artifactTypes.map((type) => (
                <button
                  key={type}
                  onClick={() => setActiveType(type)}
                  className={`text-[0.75rem] px-2.5 py-1 border transition-all duration-150 ${activeType === type ? "border-foreground text-foreground bg-foreground/[0.04]" : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"}`}
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {artifactTypeLabels[type]}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Filter: Category */}
      <div className="rule">
        <div className="container py-4">
          <div className="flex items-baseline gap-6">
            <span className="text-[0.5625rem] tracking-[0.1em] uppercase text-muted-foreground shrink-0" style={{ fontFamily: "var(--font-mono)" }}>Category</span>
            <div className="flex items-baseline gap-1 flex-wrap">
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setActiveCategory(cat)}
                  className={`text-[0.75rem] px-2.5 py-1 border transition-all duration-150 ${activeCategory === cat ? "border-foreground text-foreground bg-foreground/[0.04]" : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"}`}
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Filter: Platform */}
      <div className="rule">
        <div className="container py-4">
          <div className="flex items-baseline gap-6">
            <span className="text-[0.5625rem] tracking-[0.1em] uppercase text-muted-foreground shrink-0" style={{ fontFamily: "var(--font-mono)" }}>Platform</span>
            <div className="flex items-baseline gap-1 flex-wrap">
              {platforms.map((plat) => (
                <button
                  key={plat}
                  onClick={() => setActivePlatform(plat)}
                  className={`text-[0.75rem] px-2.5 py-1 border transition-all duration-150 ${activePlatform === plat ? "border-foreground text-foreground bg-foreground/[0.04]" : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"}`}
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {plat}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Sort bar */}
      <div className="rule rule-bottom">
        <div className="container py-3">
          <div className="flex items-baseline justify-between">
            <div className="flex items-baseline gap-6">
              <span className="text-[0.5625rem] tracking-[0.1em] uppercase text-muted-foreground shrink-0" style={{ fontFamily: "var(--font-mono)" }}>Sort by</span>
              <div className="flex items-baseline gap-1">
                {([
                  { key: "trending", label: "Trending" },
                  { key: "stars", label: "Stars" },
                  { key: "updated", label: "Updated" },
                  { key: "downloads", label: "Downloads" },
                  { key: "name", label: "Name" },
                ] as { key: SortOption; label: string }[]).map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setSortBy(opt.key)}
                    className={`text-[0.75rem] px-2.5 py-1 border transition-all duration-150 ${sortBy === opt.key ? "border-foreground text-foreground bg-foreground/[0.04]" : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"}`}
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-baseline gap-4">
              {hasActiveFilters && (
                <button
                  onClick={() => { setActiveCategory("All"); setActivePlatform("All"); setActiveType("all"); setSearchQuery(""); }}
                  className="text-[0.6875rem] hover:text-foreground transition-colors duration-150"
                  style={{ fontFamily: "var(--font-mono)", color: "var(--color-vermillion)" }}
                >
                  Clear filters
                </button>
              )}
              <span className="text-[0.6875rem] text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
                {filtered.length} result{filtered.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Skill list */}
      <div className="flex-1">
        {filtered.length > 0 ? (
          filtered.map((skill: Artifact, i: number) => (
            <SkillRow key={skill.id} skill={skill} index={i} />
          ))
        ) : (
          <div className="container py-20 text-center">
            <p className="text-[1.125rem] text-muted-foreground" style={{ fontFamily: "var(--font-display)" }}>
              No artifacts match your filters.
            </p>
            <p className="text-[0.8125rem] text-muted-foreground mt-2">
              Try adjusting your search or clearing the filters.
            </p>
          </div>
        )}
        <div className="rule" />
      </div>

      <Footer />
    </div>
  );
}
