"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import Link from "next/link";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import { artifactTypeSlugs, artifactTypeLabels, type ArtifactTypeSlug, type Category, type Platform } from "@/lib/types";
import type { Artifact } from "@/lib/types";
import { formatNumber, getTimeAgo } from "@/lib/types";
import { supabase } from "@/lib/supabase";

type SortOption = "stars" | "updated" | "downloads" | "trending" | "vibe" | "name";

export default function Explore() {
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [platforms, setPlatforms] = useState<Platform[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [activePlatform, setActivePlatform] = useState("All");
  const [activeType, setActiveType] = useState<ArtifactTypeSlug | "all">("all");
  const [sortBy, setSortBy] = useState<SortOption>("trending");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const [artifactsRes, categoriesRes, platformsRes] = await Promise.all([
          supabase
            .from("artifacts")
            .select("*,artifact_type:artifact_types(*),category:categories(*),contributor:contributors(*),artifact_platforms(platform:platforms(*))")
            .eq("status", "active")
            .order("trending_score", { ascending: false }),
          supabase
            .from("categories")
            .select("*")
            .eq("is_active", true)
            .order("sort_order"),
          supabase
            .from("platforms")
            .select("*")
            .eq("is_active", true)
            .order("sort_order"),
        ]);

        if (!artifactsRes.error && artifactsRes.data && artifactsRes.data.length > 0) {
          setArtifacts(artifactsRes.data as Artifact[]);
        }
        if (!categoriesRes.error && categoriesRes.data) {
          setCategories(categoriesRes.data as Category[]);
        }
        if (!platformsRes.error && platformsRes.data) {
          setPlatforms(platformsRes.data as Platform[]);
        }
      } catch {
        // Keep empty
      }
    }
    fetchData();
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

  // Count artifacts per type
  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: artifacts.length };
    for (const a of artifacts) {
      const slug = a.artifact_type?.slug || "unknown";
      counts[slug] = (counts[slug] || 0) + 1;
    }
    return counts;
  }, [artifacts]);

  // Count artifacts per category (based on current type filter)
  const categoryCounts = useMemo(() => {
    let base = artifacts;
    if (activeType !== "all") base = base.filter((a) => a.artifact_type?.slug === activeType);
    const counts: Record<string, number> = {};
    for (const a of base) {
      const label = a.category?.label || "Uncategorized";
      counts[label] = (counts[label] || 0) + 1;
    }
    return counts;
  }, [artifacts, activeType]);

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
    if (activeCategory !== "All") result = result.filter((s) => s.category?.label === activeCategory);
    if (activePlatform !== "All") result = result.filter((s) => s.artifact_platforms?.some(ap => ap.platform?.label === activePlatform));
    if (activeType !== "all") result = result.filter((s) => s.artifact_type?.slug === activeType);

    switch (sortBy) {
      case "stars": result = [...result].sort((a, b) => b.stars - a.stars); break;
      case "updated": result = [...result].sort((a, b) => new Date(b.github_updated_at).getTime() - new Date(a.github_updated_at).getTime()); break;
      case "downloads": result = [...result].sort((a, b) => b.weekly_downloads - a.weekly_downloads); break;
      case "trending": result = [...result].sort((a, b) => b.trending_score - a.trending_score); break;
      case "vibe": result = [...result].sort((a, b) => (b.vibe_score || 0) - (a.vibe_score || 0)); break;
      case "name": result = [...result].sort((a, b) => a.name.localeCompare(b.name)); break;
    }
    return result;
  }, [artifacts, searchQuery, activeCategory, activePlatform, activeType, sortBy]);

  const hasActiveFilters = activeCategory !== "All" || activePlatform !== "All" || activeType !== "all" || searchQuery !== "";

  return (
    <div className="min-h-screen flex flex-col">
      <Navigation />

      {/* ── Sidebar + Main layout ──────────────────── */}
      <div className="flex flex-1 min-h-0">

        {/* ── Sidebar ───────────────────────────────── */}
        <aside className="explore-sidebar hidden lg:block w-[220px] shrink-0 border-r border-border sticky top-[57px] h-[calc(100vh-57px)] overflow-y-auto">
          <div className="p-4 pr-5">

            {/* Search */}
            <div className="mb-5">
              <label className="text-[0.5625rem] tracking-[0.1em] uppercase text-muted-foreground block mb-2" style={{ fontFamily: "var(--font-mono)" }}>
                Search
              </label>
              <div className="relative">
                <input
                  ref={inputRef}
                  type="text"
                  placeholder="Filter..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-transparent border border-border px-2.5 py-1.5 text-[0.8125rem] placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground transition-colors duration-150"
                  style={{ fontFamily: "var(--font-body)" }}
                />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[0.5rem] text-muted-foreground/30 border border-border px-1 py-px" style={{ fontFamily: "var(--font-mono)" }}>
                  /
                </span>
              </div>
            </div>

            {/* Type */}
            <div className="mb-5">
              <label className="text-[0.5625rem] tracking-[0.1em] uppercase text-muted-foreground block mb-2" style={{ fontFamily: "var(--font-mono)" }}>
                Type
              </label>
              <ul className="space-y-px">
                <SidebarItem
                  label="All"
                  count={typeCounts.all || 0}
                  active={activeType === "all"}
                  onClick={() => setActiveType("all")}
                />
                {artifactTypeSlugs.map((type) => (
                  <SidebarItem
                    key={type}
                    label={artifactTypeLabels[type]}
                    count={typeCounts[type] || 0}
                    active={activeType === type}
                    onClick={() => setActiveType(type)}
                  />
                ))}
              </ul>
            </div>

            {/* Category */}
            <div className="mb-5">
              <label className="text-[0.5625rem] tracking-[0.1em] uppercase text-muted-foreground block mb-2" style={{ fontFamily: "var(--font-mono)" }}>
                Category
              </label>
              <ul className="space-y-px">
                <SidebarItem
                  label="All"
                  active={activeCategory === "All"}
                  onClick={() => setActiveCategory("All")}
                />
                {categories.map((cat) => (
                  <SidebarItem
                    key={cat.id}
                    label={cat.label}
                    count={categoryCounts[cat.label] || 0}
                    active={activeCategory === cat.label}
                    onClick={() => setActiveCategory(cat.label)}
                  />
                ))}
              </ul>
            </div>

            {/* Platform */}
            <div className="mb-5">
              <label className="text-[0.5625rem] tracking-[0.1em] uppercase text-muted-foreground block mb-2" style={{ fontFamily: "var(--font-mono)" }}>
                Platform
              </label>
              <ul className="space-y-px">
                <SidebarItem
                  label="All"
                  active={activePlatform === "All"}
                  onClick={() => setActivePlatform("All")}
                />
                {platforms.map((plat) => (
                  <SidebarItem
                    key={plat.id}
                    label={plat.label}
                    active={activePlatform === plat.label}
                    onClick={() => setActivePlatform(plat.label)}
                  />
                ))}
              </ul>
            </div>

            {/* Clear */}
            {hasActiveFilters && (
              <button
                onClick={() => { setActiveCategory("All"); setActivePlatform("All"); setActiveType("all"); setSearchQuery(""); }}
                className="text-[0.6875rem] hover:text-foreground transition-colors duration-150 mt-2"
                style={{ fontFamily: "var(--font-mono)", color: "var(--color-vermillion)" }}
              >
                Clear all filters
              </button>
            )}
          </div>
        </aside>

        {/* ── Main content ──────────────────────────── */}
        <div className="flex-1 min-w-0 flex flex-col">

          {/* Sort strip */}
          <div className="border-b border-border sticky top-[57px] bg-background/95 backdrop-blur-sm z-10">
            <div className="px-6 lg:px-8 py-2 flex items-baseline justify-between">
              <div className="flex items-baseline gap-1">
                {([
                  { key: "trending", label: "Trending" },
                  { key: "vibe", label: "Vibe" },
                  { key: "stars", label: "Stars" },
                  { key: "updated", label: "Updated" },
                  { key: "downloads", label: "Downloads" },
                  { key: "name", label: "Name" },
                ] as { key: SortOption; label: string }[]).map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => setSortBy(opt.key)}
                    className={`text-[0.6875rem] px-2 py-1 transition-all duration-100 ${sortBy === opt.key ? "text-foreground font-semibold border-b-[1.5px] border-foreground" : "text-muted-foreground hover:text-foreground border-b-[1.5px] border-transparent"}`}
                    style={{ fontFamily: "var(--font-display)" }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <span className="text-[0.625rem] text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
                {filtered.length} result{filtered.length !== 1 ? "s" : ""}
              </span>
            </div>
          </div>

          {/* Mobile filter bar (visible < lg) */}
          <div className="lg:hidden border-b border-border">
            <div className="px-4 py-3 flex gap-2 overflow-x-auto no-scrollbar">
              <input
                type="text"
                placeholder="Search..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-transparent border border-border px-2.5 py-1 text-[0.75rem] placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground transition-colors w-36 shrink-0"
                style={{ fontFamily: "var(--font-body)" }}
              />
              <select
                value={activeType}
                onChange={(e) => setActiveType(e.target.value as ArtifactTypeSlug | "all")}
                className="bg-transparent border border-border px-2 py-1 text-[0.6875rem] outline-none shrink-0"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                <option value="all">All types</option>
                {artifactTypeSlugs.map((type) => (
                  <option key={type} value={type}>{artifactTypeLabels[type]}</option>
                ))}
              </select>
              <select
                value={activeCategory}
                onChange={(e) => setActiveCategory(e.target.value)}
                className="bg-transparent border border-border px-2 py-1 text-[0.6875rem] outline-none shrink-0"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                <option value="All">All categories</option>
                {categories.map((cat) => (
                  <option key={cat.id} value={cat.label}>{cat.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Result rows */}
          <div className="flex-1">
            {filtered.length > 0 ? (
              filtered.map((artifact: Artifact, i: number) => (
                <Link key={artifact.id} href={`/skill/${artifact.slug}`}>
                  <div className="group border-b border-border py-3 px-6 lg:px-8 cursor-pointer transition-colors duration-100 hover:bg-[oklch(0.96_0.005_80)]">
                    <div className="flex items-start gap-3">
                      {/* Avatar */}
                      {artifact.contributor?.avatar_url ? (
                        <img
                          src={artifact.contributor.avatar_url}
                          alt=""
                          className="w-7 h-7 rounded-full object-cover border border-border mt-0.5 shrink-0"
                        />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-[oklch(0.93_0.005_80)] border border-border mt-0.5 shrink-0 flex items-center justify-center">
                          <span className="text-[0.4375rem] text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
                            {artifact.name.charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}

                      {/* Body */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 mb-0.5 flex-wrap">
                          <h3
                            className="text-[0.875rem] font-semibold tracking-[-0.02em] group-hover:text-[var(--color-vermillion)] transition-colors duration-100"
                            style={{ fontFamily: "var(--font-display)" }}
                          >
                            {artifact.name}
                          </h3>
                          <span
                            className="text-[0.5rem] tracking-[0.06em] uppercase text-muted-foreground border border-border px-1.5 py-px"
                            style={{ fontFamily: "var(--font-mono)" }}
                          >
                            {artifact.artifact_type?.label || "Skill"}
                          </span>
                          {artifact.category && (
                            <span
                              className="text-[0.5rem] text-muted-foreground bg-[oklch(0.93_0.005_80)] px-1.5 py-px rounded-sm"
                              style={{ fontFamily: "var(--font-mono)" }}
                            >
                              {artifact.category.label}
                            </span>
                          )}
                        </div>
                        <p className="text-[0.75rem] text-muted-foreground leading-snug line-clamp-1">
                          {artifact.description}
                        </p>
                      </div>

                      {/* Right meta */}
                      <div className="flex items-center gap-4 shrink-0 pt-1">
                        {artifact.artifact_platforms && artifact.artifact_platforms.length > 0 && (
                          <span className="text-[0.5625rem] text-muted-foreground hidden md:inline" style={{ fontFamily: "var(--font-mono)" }}>
                            {artifact.artifact_platforms[0]?.platform?.label}
                            {artifact.artifact_platforms.length > 1 ? ` +${artifact.artifact_platforms.length - 1}` : ""}
                          </span>
                        )}
                        <span className="text-[0.625rem] text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
                          {formatNumber(artifact.stars)} ★
                        </span>
                        <span className="text-[0.5625rem] text-muted-foreground hidden sm:inline" style={{ fontFamily: "var(--font-mono)" }}>
                          {getTimeAgo(artifact.github_updated_at)}
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              ))
            ) : (
              <div className="px-6 lg:px-8 py-20 text-center">
                <p className="text-[1.125rem] text-muted-foreground" style={{ fontFamily: "var(--font-display)" }}>
                  No artifacts match your filters.
                </p>
                <p className="text-[0.8125rem] text-muted-foreground mt-2">
                  Try adjusting your search or clearing the filters.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <Footer />
    </div>
  );
}

/* ── Sidebar filter item ─────────────────────────── */
function SidebarItem({ label, count, active, onClick }: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <li>
      <button
        onClick={onClick}
        className={`w-full text-left flex items-baseline justify-between px-2 py-1 -ml-2 text-[0.75rem] transition-all duration-100 border-l-2 ${
          active
            ? "text-foreground font-semibold border-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-[oklch(0.96_0.005_80)] border-transparent"
        }`}
        style={{ fontFamily: "var(--font-display)" }}
      >
        <span>{label}</span>
        {count !== undefined && count > 0 && (
          <span
            className="text-[0.5625rem] text-muted-foreground/60"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {count}
          </span>
        )}
      </button>
    </li>
  );
}
