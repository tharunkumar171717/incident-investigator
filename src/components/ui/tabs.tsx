"use client";

import { useState, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export interface TabDef {
  id: string;
  label: ReactNode;
  count?: number;
  content: ReactNode;
}

export function Tabs({ tabs, initial, onChange }: { tabs: TabDef[]; initial?: string; onChange?: (id: string) => void }) {
  const [active, setActive] = useState(initial ?? tabs[0]?.id);
  const current = tabs.find((t) => t.id === active) ?? tabs[0];
  return (
    <div>
      <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === current?.id}
            onClick={() => {
              setActive(t.id);
              onChange?.(t.id);
            }}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm whitespace-nowrap transition-colors",
              t.id === current?.id ? "border-accent font-medium text-fg" : "border-transparent text-muted hover:text-fg",
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="rounded bg-panel-2 px-1.5 text-[11px] tabular-nums text-muted">{t.count}</span>}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="pt-5">
        {current?.content}
      </div>
    </div>
  );
}
