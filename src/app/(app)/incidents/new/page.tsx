import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/misc";
import { NewIncidentForm } from "@/components/incident/new-incident-form";
import { listRepositories } from "@/lib/data";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "New incident" };

export default async function NewIncidentPage(props: PageProps<"/incidents/new">) {
  const supabase = await createClient();
  const repos = await listRepositories(supabase);
  const sp = await props.searchParams;
  return (
    <>
      <PageHeader title="New incident" description="Describe what is failing. The more runtime evidence you include (error, stack trace, logs), the more precise the investigation." />
      <NewIncidentForm
        repositories={repos.map((r) => ({ id: r.id, full_name: r.full_name, default_branch: r.default_branch, can_push: r.can_push, test_command: r.test_command }))}
        defaultRepositoryId={typeof sp.repository === "string" ? sp.repository : undefined}
      />
    </>
  );
}
