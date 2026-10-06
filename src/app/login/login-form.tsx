"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { signIn, signInWithGoogle, signUp, type AuthState } from "./actions";

export function LoginForm({ next, initialError }: { next: string; initialError: string | null }) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [state, action, pending] = useActionState<AuthState, FormData>(mode === "signin" ? signIn : signUp, { error: initialError ?? undefined });

  return (
    <Card className="p-5">
      <form action={signInWithGoogle}>
        <input type="hidden" name="next" value={next} />
        <Button type="submit" className="w-full">
          <svg viewBox="0 0 24 24" className="size-4" aria-hidden>
            <path fill="#EA4335" d="M12 10.2v3.9h5.5c-.2 1.3-1.6 3.9-5.5 3.9-3.3 0-6-2.7-6-6.1s2.7-6.1 6-6.1c1.9 0 3.1.8 3.8 1.5l2.6-2.5C16.8 3.2 14.6 2.2 12 2.2 6.6 2.2 2.2 6.6 2.2 12s4.4 9.8 9.8 9.8c5.7 0 9.4-4 9.4-9.6 0-.6-.1-1.1-.2-1.6H12z" />
          </svg>
          Continue with Google
        </Button>
      </form>
      <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wide text-subtle">
        <div className="h-px flex-1 bg-border" /> or <div className="h-px flex-1 bg-border" />
      </div>
      <form action={action} className="space-y-3">
        <input type="hidden" name="next" value={next} />
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={8} required />
        </Field>
        {state.error && <p className="text-xs text-bad">{state.error}</p>}
        {state.message && <p className="text-xs text-ok">{state.message}</p>}
        <Button type="submit" variant="primary" className="w-full" loading={pending}>
          {mode === "signin" ? "Sign in" : "Create account"}
        </Button>
      </form>
      <p className="mt-4 text-center text-xs text-muted">
        {mode === "signin" ? "No account yet? " : "Already registered? "}
        <button type="button" className="text-accent hover:underline" onClick={() => setMode(mode === "signin" ? "signup" : "signin")}>
          {mode === "signin" ? "Create one" : "Sign in"}
        </button>
      </p>
    </Card>
  );
}
