import type { Metadata } from "next";
import { Siren } from "lucide-react";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage(props: PageProps<"/login">) {
  const sp = await props.searchParams;
  const next = typeof sp.next === "string" ? sp.next : "/";
  const error = typeof sp.error === "string" ? sp.error : null;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex size-8 items-center justify-center rounded-md bg-accent text-accent-fg">
            <Siren className="size-4" />
          </div>
          <div>
            <div className="text-base font-semibold">Incident Investigator</div>
            <div className="text-xs text-muted">Sign in with your Supabase account</div>
          </div>
        </div>
        <LoginForm next={next} initialError={error} />
      </div>
    </main>
  );
}
