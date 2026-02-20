import Link from "next/link";
import Navigation from "@/components/Navigation";
import Footer from "@/components/Footer";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col">
      <Navigation />
      <div className="container py-20 text-center flex-1">
        <h1
          className="text-[2rem] font-bold tracking-[-0.03em]"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Page not found
        </h1>
        <p className="mt-3 text-muted-foreground">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link href="/">
          <span className="inline-block mt-6 text-[0.8125rem] editorial-link" style={{ fontFamily: "var(--font-display)" }}>
            Back to home
          </span>
        </Link>
      </div>
      <Footer />
    </div>
  );
}
