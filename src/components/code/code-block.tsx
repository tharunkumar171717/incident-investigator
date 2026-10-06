"use client";

import { useEffect, useState } from "react";
import { Copy, FileCode2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/cn";

interface Props {
  code: string;
  language?: string;
  path?: string;
  startLine?: number;
  highlight?: number[];
  maxHeight?: number;
  className?: string;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

/** Syntax-highlighted code with real line numbers and highlighted lines. Shiki is loaded lazily. */
export function CodeBlock({ code, language = "text", path, startLine = 1, highlight = [], maxHeight = 480, className }: Props) {
  const [html, setHtml] = useState<string | null>(null);
  const hl = highlight.join(",");

  useEffect(() => {
    let cancelled = false;
    const lines = new Set(hl ? hl.split(",").map(Number) : []);
    import("shiki")
      .then(async ({ codeToHtml, bundledLanguages }) => {
        const lang = language in bundledLanguages ? language : "text";
        const out = await codeToHtml(code, {
          lang,
          themes: { light: "github-light", dark: "github-dark" },
          defaultColor: false,
          transformers: [
            {
              line(node, line) {
                const n = startLine + line - 1;
                node.properties["data-line"] = n;
                if (lines.has(n)) this.addClassToHast(node, "highlighted");
              },
            },
          ],
        });
        if (!cancelled) setHtml(out);
      })
      .catch(() => {
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [code, language, startLine, hl]);

  const fallback = `<pre class="shiki"><code>${code
    .split("\n")
    .map((l, i) => `<span class="line${highlight.includes(startLine + i) ? " highlighted" : ""}" data-line="${startLine + i}">${escapeHtml(l)}</span>`)
    .join("\n")}</code></pre>`;

  return (
    <div className={cn("overflow-hidden rounded-md border border-border bg-code", className)}>
      {path && (
        <div className="flex items-center justify-between gap-2 border-b border-border bg-panel-2 px-3 py-1.5">
          <div className="flex min-w-0 items-center gap-2 font-mono text-xs text-muted">
            <FileCode2 className="size-3.5 shrink-0" />
            <span className="truncate">
              {path}
              {startLine > 1 || highlight.length ? <span className="text-subtle">:{highlight[0] ?? startLine}</span> : null}
            </span>
          </div>
          <button
            onClick={() => navigator.clipboard.writeText(code).then(() => toast.success("Copied"))}
            className="rounded p-1 text-subtle hover:bg-panel hover:text-fg"
            aria-label="Copy code"
          >
            <Copy className="size-3.5" />
          </button>
        </div>
      )}
      <div className="code-block overflow-auto font-mono" style={{ maxHeight }} dangerouslySetInnerHTML={{ __html: html ?? fallback }} />
    </div>
  );
}
