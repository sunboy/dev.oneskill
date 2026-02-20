import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "OneSkill — The Open Directory for Agent Artifacts",
  description: "Skills, MCP servers, Cursor rules, n8n nodes, and more — automatically indexed from GitHub. Compatible with 38+ agent platforms.",
  openGraph: {
    title: "OneSkill — The Open Directory for Agent Artifacts",
    description: "Skills, MCP servers, Cursor rules, n8n nodes, and more — automatically indexed from GitHub.",
    siteName: "OneSkill",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "OneSkill — The Open Directory for Agent Artifacts",
    description: "Skills, MCP servers, Cursor rules, n8n nodes, and more — automatically indexed from GitHub.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,600;0,8..60,700;1,8..60,400&family=Space+Grotesk:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        {children}
        <Toaster />
      </body>
    </html>
  );
}
