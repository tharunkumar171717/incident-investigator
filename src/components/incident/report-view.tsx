import { ArrowDown, FileCode2, GitCommitHorizontal, Globe, ScrollText, Search, Shield, Target } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import type { EvidenceItem, RootCauseFindingRow } from "@/lib/db/types";

const EVIDENCE_ICON: Record<EvidenceItem["type"], typeof Search> = {
  stack_trace: Target,
  log: ScrollText,
  code: FileCode2,
  commit: GitCommitHorizontal,
  endpoint: Globe,
  other: Search,
};

export function ReportView({ finding }: { finding: RootCauseFindingRow }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_300px]">
      <div className="space-y-5">
        <Card>
          <CardHeader title="Root cause" description={finding.root_cause_found ? "Supported by the evidence below" : "Not established — treat as a hypothesis"} />
          <CardBody className="space-y-3">
            <p className="whitespace-pre-wrap text-sm leading-relaxed">{finding.root_cause}</p>
            <p className="whitespace-pre-wrap border-t border-border pt-3 text-sm leading-relaxed text-muted">{finding.summary}</p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Evidence" description={`${finding.evidence.length} item(s) gathered during the investigation`} />
          <ul className="divide-y divide-border">
            {finding.evidence.map((e, i) => {
              const Icon = EVIDENCE_ICON[e.type] ?? Search;
              return (
                <li key={i} className="flex gap-3 px-4 py-3">
                  <Icon className="mt-0.5 size-4 shrink-0 text-accent" />
                  <div className="min-w-0">
                    <p className="text-sm">{e.description}</p>
                    <p className="mt-0.5 truncate font-mono text-xs text-subtle">
                      {e.type.replace("_", " ")} · {e.source}
                    </p>
                  </div>
                </li>
              );
            })}
            {finding.evidence.length === 0 && <li className="px-4 py-3 text-sm text-muted">No evidence was recorded.</li>}
          </ul>
        </Card>

        {finding.suggested_fix && (
          <Card>
            <CardHeader title="Suggested fix" />
            <CardBody>
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{finding.suggested_fix}</p>
            </CardBody>
          </Card>
        )}
      </div>

      <div className="space-y-5">
        {finding.call_chain.length > 0 && (
          <Card>
            <CardHeader title="Call chain" />
            <CardBody>
              <ol className="space-y-1">
                {finding.call_chain.map((c, i) => (
                  <li key={i}>
                    <div className="rounded-md border border-border bg-panel-2 px-2.5 py-1.5 font-mono text-xs break-words">{c}</div>
                    {i < finding.call_chain.length - 1 && <ArrowDown className="mx-auto my-0.5 size-3 text-subtle" />}
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        )}
        <Card>
          <CardHeader title="Affected files" />
          <CardBody>
            {finding.affected_files.length ? (
              <ul className="space-y-1">
                {finding.affected_files.map((f) => (
                  <li key={f} className="flex items-center gap-2 font-mono text-xs break-all">
                    <FileCode2 className="size-3.5 shrink-0 text-subtle" /> {f}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">None identified.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Risk & recommended action" />
          <CardBody className="space-y-3 text-sm">
            <div className="flex gap-2">
              <Shield className="mt-0.5 size-4 shrink-0 text-warn" />
              <p className="whitespace-pre-wrap">{finding.risk || "—"}</p>
            </div>
            <div className="flex gap-2 border-t border-border pt-3">
              <Target className="mt-0.5 size-4 shrink-0 text-accent" />
              <p className="whitespace-pre-wrap">{finding.recommended_action || "—"}</p>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
