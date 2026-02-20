"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navLinks = [
  { href: "/", label: "Index" },
  { href: "/explore", label: "Explore" },
  { href: "/submit", label: "Submit" },
];

export default function Navigation() {
  const pathname = usePathname();

  return (
    <header className="rule-bottom sticky top-0 z-50 bg-background/95 backdrop-blur-sm">
      <div className="container">
        <nav className="flex items-baseline justify-between py-4">
          <Link href="/">
            <span
              className="text-[1.125rem] font-bold tracking-[-0.04em]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              OneSkill
            </span>
          </Link>

          <div className="flex items-baseline gap-8">
            {navLinks.map((link) => (
              <Link key={link.href} href={link.href}>
                <span
                  className={`text-[0.8125rem] tracking-[0.02em] transition-colors duration-150 ${
                    pathname === link.href
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                  style={{ fontFamily: "var(--font-display)" }}
                >
                  {link.label}
                </span>
              </Link>
            ))}
            <Link href="/submit">
              <span
                className="text-[0.8125rem] tracking-[0.02em] transition-opacity duration-150 hover:opacity-70"
                style={{ fontFamily: "var(--font-mono)", color: "var(--color-vermillion)" }}
              >
                + Add Artifact
              </span>
            </Link>
          </div>
        </nav>
      </div>
    </header>
  );
}
