// Exercises the real tool implementations (search, references, read, fix,
// test, sandboxed test run) against the bundled demo repository on disk.
// No network, database or AI provider is involved.
import assert from "node:assert/strict";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "sb_publishable_test_000000000000";
process.env.SUPABASE_SECRET_KEY ??= "sb_secret_test_000000000000000000";
process.env.ENABLE_TEST_EXECUTION = "true";

const { executeTool } = await import("@/lib/tools/registry");
type Ctx = import("@/lib/tools/types").ToolContext;
type Ws = import("@/lib/github/workspace").Workspace;

const root = path.resolve("examples/orders-service");
function walk(dir: string, rel = ""): string[] {
  return readdirSync(dir).flatMap((name) => {
    const r = rel ? `${rel}/${name}` : name;
    return statSync(path.join(dir, name)).isDirectory() ? walk(path.join(dir, name), r) : [r];
  });
}
const ws: Ws = { repo: { owner: "demo", name: "orders-service" }, sha: "local", root, files: walk(root).sort() };

const ctx: Ctx = {
  userId: "test",
  investigationId: null,
  incident: null,
  repository: { test_command: "node --test", setup_command: null, default_branch: "main" } as Ctx["repository"],
  repo: ws.repo,
  ref: "main",
  sha: "local",
  workspace: async () => ws,
  db: null,
  state: { fixId: null, fixDescription: null, changes: [], lastTest: null, report: null },
  signal: new AbortController().signal,
};
const run = (name: string, input: unknown) => executeTool(name, input, ctx, 60_000);

test("search_code finds the route", async () => {
  const r = await run("search_code", { query: "/api/orders" });
  assert.ok(!r.result.isError, r.result.output);
  assert.match(r.result.output, /src\/server\.js:\d+:/);
});

test("find_references locates getUser definition and its caller", async () => {
  const r = await run("find_references", { symbol: "getUser" });
  assert.match(r.result.output, /Definitions of getUser \(1\):\nsrc\/repositories\/user_repository\.js:\d+: function getUser/);
  assert.match(r.result.output, /src\/services\/order_service\.js:\d+: .*getUser\(userId\)/);
});

test("read_file returns numbered lines and rejects traversal", async () => {
  const r = await run("read_file", { path: "src/services/order_service.js", start_line: 19, end_line: 21 });
  assert.match(r.result.output, /20 \|\s+ownerId: user\.id,/);
  const bad = await run("read_file", { path: "../../package.json" });
  assert.ok(bad.result.isError);
  assert.match(bad.result.output, /outside the repository/);
});

test("invalid tool input is reported, not thrown", async () => {
  const r = await run("find_references", { symbol: "not valid!" });
  assert.ok(r.result.isError);
  assert.match(r.result.output, /Invalid input/);
});

test("propose_fix validates exact matches", async () => {
  const miss = await run("propose_fix", { description: "a fix that does not apply", edits: [{ path: "src/services/order_service.js", search: "nope()", replace: "x" }] });
  assert.ok(miss.result.isError);
  assert.match(miss.result.output, /not found/);
});

test("regression test fails without the fix and passes with it", async () => {
  const testFile = `const test = require("node:test");
const assert = require("node:assert/strict");
const { createOrder } = require("../src/services/order_service");

test("rejects orders for unknown or deleted users with a 404", () => {
  assert.throws(() => createOrder("u_300", [{ sku: "sku_book" }]), (err) => err.status === 404);
});
`;
  const w = await run("write_test", { path: "test/order_unknown_user.test.js", content: testFile, description: "regression test for deleted users" });
  assert.ok(!w.result.isError, w.result.output);

  const before = await run("run_tests", { mode: "without_fix", target: "test/order_unknown_user.test.js" });
  assert.equal(ctx.state.lastTest?.status, "failed", before.result.output);

  const fix = await run("propose_fix", {
    description: "Return 404 when getUser() returns null instead of dereferencing it.",
    edits: [
      {
        path: "src/services/order_service.js",
        search: "  const user = userRepository.getUser(userId);\n",
        replace: "  const user = userRepository.getUser(userId);\n  if (!user) throw Object.assign(new Error(`user ${userId} not found`), { status: 404 });\n",
      },
    ],
  });
  assert.ok(!fix.result.isError, fix.result.output);
  assert.match(fix.result.output, /\+  if \(!user\) throw/);

  const after = await run("run_tests", { mode: "with_fix" });
  assert.equal(ctx.state.lastTest?.status, "passed", after.result.output);
  assert.equal(ctx.state.changes.length, 2);
});
