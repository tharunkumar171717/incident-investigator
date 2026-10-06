import { NextResponse } from "next/server";
import { allowedOwners } from "@/lib/env";
import { readClient } from "@/lib/github/client";
import { toGitHubError } from "@/lib/github/errors";
import { handle, requireUser } from "@/lib/http";

/** Repositories visible to the server's GitHub token, for the connect picker. */
export const GET = handle(async () => {
  await requireUser();
  try {
    const { data } = await readClient().repos.listForAuthenticatedUser({ per_page: 100, sort: "pushed" });
    const allowed = allowedOwners();
    return NextResponse.json(
      data
        .filter((r) => !allowed || allowed.includes(r.owner.login.toLowerCase()))
        .map((r) => ({ full_name: r.full_name, private: r.private, description: r.description, pushed_at: r.pushed_at, language: r.language })),
    );
  } catch (err) {
    throw toGitHubError(err, "list repositories for the server token");
  }
});
