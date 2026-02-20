import Link from "next/link";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";
import SkillRow from "@/components/SkillRow";
import { getArtifacts } from "@/lib/data";
import type { Artifact } from "@/lib/types";

export default async function ContributorProfile({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const allArtifacts = await getArtifacts();
  const artifacts = allArtifacts.filter(a => a.contributor?.github_username === username);

  return (
    <div className="min-h-screen flex flex-col">
      <Navigation />

      <div className="container pt-12 pb-8">
        <Link href="/explore">
          <span className="text-[0.6875rem] text-muted-foreground editorial-link" style={{ fontFamily: "var(--font-mono)" }}>
            ← Back to Explore
          </span>
        </Link>
        <h1
          className="text-[clamp(2rem,4vw,3.25rem)] font-bold tracking-[-0.04em] leading-[1] mt-6"
          style={{ fontFamily: "var(--font-display)" }}
        >
          @{username}
        </h1>
        <p className="mt-3 text-[0.9375rem] text-muted-foreground">
          {artifacts.length} artifact{artifacts.length !== 1 ? "s" : ""} in the directory
        </p>
      </div>

      <div className="rule flex-1">
        {artifacts.length > 0 ? (
          artifacts.map((skill: Artifact, i: number) => (
            <SkillRow key={skill.id} skill={skill} index={i} />
          ))
        ) : (
          <div className="container py-20 text-center">
            <p className="text-[1.125rem] text-muted-foreground" style={{ fontFamily: "var(--font-display)" }}>
              No artifacts found for this contributor.
            </p>
          </div>
        )}
        <div className="rule" />
      </div>

      <Footer />
    </div>
  );
}
