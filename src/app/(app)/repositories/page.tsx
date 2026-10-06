import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/misc";
import { RepositoryManager } from "@/components/repositories/repository-manager";
import { env } from "@/lib/env";
import { listRepositories } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Repositories" };
export const dynamic = "force-dynamic";

export default async function RepositoriesPage() {
  const supabase = await createClient();
  const repos = await listRepositories(supabase);
  const e = env();
  return (
    <>
      <PageHeader title="Repositories" description="GitHub repositories the investigation agent can search and read. Access uses the server-side token; it is never sent to the browser." />
      <RepositoryManager
        initial={repos}
        server={{ tokenConfigured: Boolean(e.GITHUB_TOKEN), writeTokenConfigured: Boolean(e.GITHUB_WRITE_TOKEN), testExecution: e.ENABLE_TEST_EXECUTION }}
      />
    </>
  );
}
