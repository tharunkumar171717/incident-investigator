import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { IncidentView } from "@/components/incident/incident-view";
import { getIncidentBundle } from "@/lib/data";
import type { IncidentLogRow } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(props: PageProps<"/incidents/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const supabase = await createClient();
  const { data } = await supabase.from("incidents").select("title").eq("id", id).maybeSingle();
  return { title: data?.title ?? "Incident" };
}

export default async function IncidentPage(props: PageProps<"/incidents/[id]">) {
  const { id } = await props.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const bundle = await getIncidentBundle(supabase, id);
  if (!bundle) notFound();
  const { data: logs } = await supabase.from("incident_logs").select("*").eq("incident_id", id).order("line_no").limit(1000).returns<IncidentLogRow[]>();
  return <IncidentView initial={bundle} logs={logs ?? []} />;
}
