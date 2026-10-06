"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  const schemaMissing = /incidents|relation .* does not exist|schema cache/i.test(error.message);
  const config = /environment|SUPABASE_|\.env/i.test(error.message);
  return (
    <Card className="mx-auto mt-10 max-w-xl p-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-bad" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Something went wrong</h2>
          <p className="mt-1 break-words text-sm text-muted">{error.message || "Unexpected error."}</p>
          {schemaMissing && <p className="mt-2 text-xs text-muted">The database tables may not exist yet. Run <code className="font-mono">npm run db:migrate</code>.</p>}
          {config && <p className="mt-2 text-xs text-muted">Check <code className="font-mono">.env.local</code> against <code className="font-mono">.env.example</code>.</p>}
          {error.digest && <p className="mt-2 font-mono text-[11px] text-subtle">digest {error.digest}</p>}
          <Button className="mt-4" onClick={reset}>
            Try again
          </Button>
        </div>
      </div>
    </Card>
  );
}
