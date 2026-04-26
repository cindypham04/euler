import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { cn } from "@/lib/utils";

const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_PLUGINS = [rehypeKatex];

export function Markdown({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "text-[0.95rem] leading-relaxed",
        // Headings — display serif for textbook feel
        "[&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:font-display [&_h1]:text-2xl [&_h1]:font-semibold [&_h1]:tracking-tight",
        "[&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:font-display [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:tracking-tight",
        "[&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:font-display [&_h3]:text-lg [&_h3]:font-medium [&_h3]:italic",
        // Paragraphs and inline elements
        "[&_p]:my-3 [&_p:first-child]:mt-0 [&_p:last-child]:mb-0",
        "[&_strong]:font-semibold",
        "[&_em]:italic [&_em]:font-display",
        "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-primary/40 hover:[&_a]:decoration-primary",
        // Lists
        "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:marker:text-primary/60",
        "[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:marker:font-display [&_ol]:marker:italic [&_ol]:marker:text-primary/70",
        "[&_li]:my-1",
        // Code
        "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.85em]",
        "[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-border [&_pre]:bg-muted/60 [&_pre]:p-3",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0",
        // Blockquotes — textbook callout
        "[&_blockquote]:my-4 [&_blockquote]:border-l-2 [&_blockquote]:border-primary [&_blockquote]:bg-primary/5 [&_blockquote]:py-1 [&_blockquote]:pl-4 [&_blockquote]:font-display [&_blockquote]:italic [&_blockquote]:text-foreground/85",
        // Tables
        "[&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm",
        "[&_th]:border-b [&_th]:border-foreground/30 [&_th]:px-2 [&_th]:py-2 [&_th]:text-left [&_th]:font-display [&_th]:font-medium [&_th]:italic",
        "[&_td]:border-b [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5",
        // KaTeX display math: allow horizontal scroll on overflow
        "[&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden",
        // Horizontal rule
        "[&_hr]:my-6 [&_hr]:border-0 [&_hr]:border-t [&_hr]:border-foreground/15",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        rehypePlugins={REHYPE_PLUGINS}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
