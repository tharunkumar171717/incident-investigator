// MCP server (stdio) exposing the investigation's read-only GitHub repository
// tools: list_repository_files, search_code, read_file, get_file,
// find_references, get_recent_commits, get_commit, get_branch.
//
// It reuses the exact tool registry the in-app agent uses, so any MCP client
// (Claude Desktop, Claude Code, ...) can investigate a repository the same way.
//
//   MCP_REPOSITORY=owner/name [MCP_REF=main] npm run mcp
//
// Run with --conditions=react-server (the npm script does) so server-only
// modules load outside Next.js. Never log to stdout: it carries the protocol.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

try {
  process.loadEnvFile(".env.local");
} catch {
  // rely on the real environment
}

const { getRepoMetadata, parseRepoInput, resolveRef } = await import("@/lib/github/client");
const { getWorkspace } = await import("@/lib/github/workspace");
const { executeTool, mcpTools } = await import("@/lib/tools/registry");
type Ctx = import("@/lib/tools/types").ToolContext;

const repoArg = process.env.MCP_REPOSITORY ?? process.argv[2];
const repo = repoArg ? parseRepoInput(repoArg) : null;
if (!repo) {
  console.error("Set MCP_REPOSITORY=owner/name (or pass it as the first argument).");
  process.exit(1);
}

let meta: Awaited<ReturnType<typeof getRepoMetadata>>;
let ref: string;
let sha: string;
try {
  meta = await getRepoMetadata(repo);
  ref = process.env.MCP_REF || meta.default_branch;
  sha = await resolveRef(repo, ref);
} catch (err) {
  console.error(`[mcp] cannot open ${repoArg}: ${(err as Error).message}`);
  process.exit(1);
}
console.error(`[mcp] ${meta.full_name}@${ref} (${sha.slice(0, 7)})`);

let workspace: ReturnType<typeof getWorkspace> | null = null;
const ctx: Ctx = {
  userId: "mcp",
  investigationId: null,
  incident: null,
  repository: null,
  repo,
  ref,
  sha,
  workspace: () => (workspace ??= getWorkspace(repo, sha)),
  db: null,
  state: { fixId: null, fixDescription: null, changes: [], lastTest: null, report: null },
  signal: new AbortController().signal,
};

const server = new McpServer({ name: "incident-investigator-github", version: "0.1.0" });
for (const tool of mcpTools()) {
  server.registerTool(
    tool.name,
    { description: tool.description, inputSchema: tool.schema.shape, annotations: { readOnlyHint: true, openWorldHint: false } },
    async (args: unknown) => {
      const ex = await executeTool(tool.name, args, ctx, 60_000);
      return { content: [{ type: "text" as const, text: ex.result.output }], isError: Boolean(ex.result.isError) };
    },
  );
}

await server.connect(new StdioServerTransport());
