import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { IncidentLogRow, IncidentRow } from "@/lib/db/types";
import { cn } from "@/lib/cn";

const LEVEL_CLASS: Record<string, string> = { fatal: "text-bad", error: "text-bad", warn: "text-warn", info: "text-info", debug: "text-subtle", trace: "text-subtle" };

export function IncidentInput({ incident, logs, logCount }: { incident: IncidentRow; logs: IncidentLogRow[]; logCount: number }) {
  const blocks: Array<[string, string | null, boolean]> = [
    ["Description", incident.description, false],
    ["Error message", incident.error_message, true],
    ["Stack trace", incident.stack_trace, true],
    ["Additional context", incident.additional_context, false],
  ];
  return (
    <div className="space-y-5">
      {blocks
        .filter(([, v]) => v)
        .map(([label, value, mono]) => (
          <Card key={label}>
            <CardHeader title={label} />
            <CardBody>
              <pre className={cn("max-h-96 overflow-auto whitespace-pre-wrap text-sm", mono && "font-mono text-xs")}>{value}</pre>
            </CardBody>
          </Card>
        ))}
      <Card>
        <CardHeader title="Logs" description={`${logCount} line(s)${logs.length < logCount ? `, showing first ${logs.length}` : ""}`} />
        {logs.length ? (
          <div className="max-h-[480px] overflow-auto bg-code py-2 font-mono text-[11.5px] leading-relaxed">
            {logs.map((l) => (
              <div key={l.id} className="flex gap-3 px-3 hover:bg-panel-2">
                <span className="w-8 shrink-0 text-right text-subtle select-none">{l.line_no}</span>
                {l.level ? <span className={cn("w-10 shrink-0 uppercase", LEVEL_CLASS[l.level])}>{l.level}</span> : <span className="w-10 shrink-0" />}
                <span className="break-all whitespace-pre-wrap">{l.message}</span>
              </div>
            ))}
          </div>
        ) : (
          <CardBody>
            <p className="text-sm text-muted">No logs attached.</p>
          </CardBody>
        )}
      </Card>
      {incident.auto_fix && (
        <p className="text-xs text-muted">
          <Badge tone="warn">auto-fix</Badge> A pull request is opened automatically when a fix is verified.
        </p>
      )}
    </div>
  );
}
