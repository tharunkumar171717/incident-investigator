import { CodeBlock } from "@/components/code/code-block";
import { EmptyState } from "@/components/ui/misc";
import type { CodeReference } from "@/lib/db/types";

export function CodeReferences({ refs, repoUrl, sha }: { refs: CodeReference[]; repoUrl: string | null; sha: string | null }) {
  if (!refs.length) return <EmptyState title="No code references" description="The agent did not cite specific code regions for this investigation." />;
  return (
    <div className="space-y-6">
      {refs.map((r, i) => (
        <section key={i} className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-mono text-sm font-medium">
              {r.path}:{r.highlight_lines[0] ?? r.start_line}
            </h3>
            {repoUrl && sha && !r.missing && (
              <a
                href={`${repoUrl}/blob/${sha}/${r.path}#L${r.start_line}-L${r.end_line}`}
                target="_blank"
                rel="noreferrer"
                className="text-xs text-accent hover:underline"
              >
                View on GitHub
              </a>
            )}
          </div>
          <p className="text-sm leading-relaxed text-muted">{r.explanation}</p>
          {r.missing || !r.code ? (
            <div className="rounded-md border border-dashed border-border p-3 text-xs text-muted">
              Lines {r.start_line}-{r.end_line} could not be loaded from the repository snapshot.
            </div>
          ) : (
            <CodeBlock code={r.code} language={r.language} path={r.path} startLine={r.start_line} highlight={r.highlight_lines} />
          )}
        </section>
      ))}
    </div>
  );
}
