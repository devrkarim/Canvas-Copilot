"use client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown for model output. remark-gfm is what makes tables, strikethrough and
 * bare URLs work — plain react-markdown is CommonMark only, so a GFM table comes
 * out as one run-on paragraph. Pair with the `.prose-chat` styles in globals.css.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // Wide tables scroll inside the bubble instead of stretching it.
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto">
            <table>{children}</table>
          </div>
        ),
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noreferrer">{children}</a>
        ),
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
