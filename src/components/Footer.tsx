import Link from "next/link";

export default function Footer() {
  return (
    <footer className="rule">
      <div className="container py-12">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <span
              className="text-[1rem] font-bold tracking-[-0.04em]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              OneSkill
            </span>
            <p className="text-[0.8125rem] text-muted-foreground mt-2 leading-relaxed">
              The open directory for agent artifacts. Automatically indexed from GitHub.
            </p>
          </div>
          <div>
            <span
              className="text-[0.625rem] tracking-[0.08em] uppercase text-muted-foreground block mb-3"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Directory
            </span>
            <div className="flex flex-col gap-2">
              <Link href="/explore" className="text-[0.8125rem] text-muted-foreground hover:text-foreground transition-colors">
                Explore
              </Link>
              <Link href="/submit" className="text-[0.8125rem] text-muted-foreground hover:text-foreground transition-colors">
                Submit
              </Link>
            </div>
          </div>
          <div>
            <span
              className="text-[0.625rem] tracking-[0.08em] uppercase text-muted-foreground block mb-3"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Resources
            </span>
            <div className="flex flex-col gap-2">
              <a href="https://github.com/sunboy/dev.oneskill" target="_blank" rel="noopener noreferrer" className="text-[0.8125rem] text-muted-foreground hover:text-foreground transition-colors">
                GitHub
              </a>
            </div>
          </div>
          <div>
            <span
              className="text-[0.625rem] tracking-[0.08em] uppercase text-muted-foreground block mb-3"
              style={{ fontFamily: "var(--font-mono)" }}
            >
              Built with
            </span>
            <p className="text-[0.75rem] text-muted-foreground" style={{ fontFamily: "var(--font-mono)" }}>
              Next.js · Supabase · Vercel
            </p>
          </div>
        </div>
        <div className="rule mt-8 pt-6">
          <p
            className="text-[0.6875rem] text-muted-foreground"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            © {new Date().getFullYear()} OneSkill. Open source under MIT.
          </p>
        </div>
      </div>
    </footer>
  );
}
