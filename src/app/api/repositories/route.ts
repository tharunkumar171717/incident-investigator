import { NextResponse } from "next/server";
import { getRepoMetadata, parseRepoInput } from "@/lib/github/client";
import { dbError, handle, HttpError, parseBody, requireUser } from "@/lib/http";
import { listRepositories } from "@/lib/data";
import { connectRepositorySchema } from "@/lib/validation";

export const GET = handle(async () => {
  const { supabase } = await requireUser();
  return NextResponse.json(await listRepositories(supabase));
});

export const POST = handle(async (req: Request) => {
  const { supabase, userId } = await requireUser();
  const { repository } = await parseBody(req, connectRepositorySchema);
  const ref = parseRepoInput(repository);
  if (!ref) throw new HttpError(422, 'Enter a repository as "owner/name" or a github.com URL.', "invalid_repository");

  const meta = await getRepoMetadata(ref); // throws a mapped GitHubError on 401/403/404
  const row = {
    user_id: userId,
    owner: meta.owner.login,
    name: meta.name,
    default_branch: meta.default_branch,
    html_url: meta.html_url,
    description: meta.description,
    language: meta.language,
    is_private: meta.private,
    can_push: Boolean(meta.permissions?.push),
    metadata: {
      stars: meta.stargazers_count,
      open_issues: meta.open_issues_count,
      size_kb: meta.size,
      pushed_at: meta.pushed_at,
      visibility: meta.visibility,
      archived: meta.archived,
    },
    last_verified_at: new Date().toISOString(),
    last_error: null,
  };
  const { data, error } = await supabase.from("repositories").upsert(row, { onConflict: "user_id,owner,name" }).select("*").single();
  if (error) dbError(error, "save the repository");
  return NextResponse.json(data, { status: 201 });
});
