import { cn } from "@/lib/cn";

/** Renders a unified diff with old/new line numbers. */
export function DiffView({ diff, path, isNew }: { diff: string; path: string; isNew?: boolean }) {
  const rows: Array<{ type: "hunk" | "add" | "del" | "ctx"; text: string; oldNo?: number; newNo?: number }> = [];
  let oldNo = 0;
  let newNo = 0;
  let adds = 0;
  let dels = 0;
  for (const line of diff.split("\n")) {
    if (line.startsWith("Index:") || line.startsWith("====") || line.startsWith("---") || line.startsWith("+++")) continue;
    if (line.startsWith("@@")) {
      const m = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)/);
      oldNo = m ? +m[1] : 0;
      newNo = m ? +m[2] : 0;
      rows.push({ type: "hunk", text: line });
    } else if (line.startsWith("+")) {
      rows.push({ type: "add", text: line.slice(1), newNo: newNo++ });
      adds++;
    } else if (line.startsWith("-")) {
      rows.push({ type: "del", text: line.slice(1), oldNo: oldNo++ });
      dels++;
    } else if (line.startsWith(" ")) {
      rows.push({ type: "ctx", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
    }
  }
  return (
    <div className="overflow-hidden rounded-md border border-border bg-code">
      <div className="flex items-center justify-between border-b border-border bg-panel-2 px-3 py-1.5 font-mono text-xs">
        <span className="truncate text-muted">
          {path} {isNew && <span className="ml-1 rounded bg-ok-soft px-1 text-ok">new</span>}
        </span>
        <span className="shrink-0 tabular-nums">
          <span className="text-ok">+{adds}</span> <span className="text-bad">−{dels}</span>
        </span>
      </div>
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full border-collapse font-mono text-[12.5px] leading-[1.6]">
          <tbody>
            {rows.map((r, i) =>
              r.type === "hunk" ? (
                <tr key={i} className="bg-accent-soft/60 text-accent">
                  <td colSpan={3} className="px-3 py-0.5 text-[11.5px]">
                    {r.text}
                  </td>
                </tr>
              ) : (
                <tr key={i} className={cn(r.type === "add" && "bg-ok-soft", r.type === "del" && "bg-bad-soft")}>
                  <td className="w-10 select-none px-2 text-right text-subtle">{r.oldNo ?? ""}</td>
                  <td className="w-10 select-none px-2 text-right text-subtle">{r.newNo ?? ""}</td>
                  <td className="whitespace-pre px-2">
                    <span className={cn("mr-2 select-none", r.type === "add" ? "text-ok" : r.type === "del" ? "text-bad" : "text-subtle")}>
                      {r.type === "add" ? "+" : r.type === "del" ? "−" : " "}
                    </span>
                    {r.text}
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
