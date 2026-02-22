"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export default function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="readme-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Open external links in new tab
          a: ({ href, children, ...props }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
              {children}
            </a>
          ),
          // Prevent rendering images from untrusted READMEs as full <img> tags
          // (badges/shields are fine, but we don't want huge images breaking layout)
          img: ({ src, alt, ...props }) => (
            <img src={src} alt={alt || ""} loading="lazy" {...props} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
