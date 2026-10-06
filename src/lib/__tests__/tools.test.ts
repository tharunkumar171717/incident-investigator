import assert from "node:assert/strict";
import { test } from "node:test";
import { splitCommand } from "@/lib/tools/test-runner";
import { globToRegExp } from "@/lib/tools/util";
import { reportSchema } from "@/lib/agent/report-schema";
import { agentTools, toJsonSpec } from "@/lib/tools/registry";

test("splitCommand splits argv and rejects shell operators", () => {
  assert.deepEqual(splitCommand("pytest -q 'tests/a b.py'"), ["pytest", "-q", "tests/a b.py"]);
  assert.deepEqual(splitCommand("node --test"), ["node", "--test"]);
  for (const bad of ["npm test && rm -rf /", "pytest; curl x", "echo $HOME", "a | b", "cat < x"]) {
    assert.throws(() => splitCommand(bad), /shell operators/);
  }
});

test("globToRegExp matches basenames and paths", () => {
  assert.ok(globToRegExp("*.py").test("app/services/order_service.py"));
  assert.ok(globToRegExp("**/*order*").test("src/services/order_service.ts"));
  assert.ok(!globToRegExp("**/*order*").test("src/orders/create.ts"));
  assert.ok(globToRegExp("src/*.ts").test("src/a.ts"));
  assert.ok(!globToRegExp("src/*.ts").test("src/x/a.ts"));
});

test("agent never receives repository write tools", () => {
  const names = agentTools({ hasRepo: true }).map((t) => t.name);
  for (const w of ["create_branch", "update_file", "create_pull_request"]) assert.ok(!names.includes(w));
  assert.ok(names.includes("search_code") && names.includes("submit_report"));
  const noRepo = agentTools({ hasRepo: false }).map((t) => t.name);
  assert.deepEqual(noRepo.sort(), ["query_logs", "submit_report"]);
});

test("tool JSON schemas are plain objects without $schema", () => {
  for (const t of agentTools({ hasRepo: true })) {
    const spec = toJsonSpec(t);
    assert.equal(spec.input_schema.type, "object");
    assert.ok(!("$schema" in spec.input_schema));
  }
});

test("report schema rejects out-of-range confidence", () => {
  const base = {
    root_cause_found: true,
    summary: "s",
    severity: "high",
    confidence: 80,
    affected_service: "orders",
    affected_endpoint: "POST /orders",
    root_cause: "r",
    evidence: [],
    affected_files: [],
    call_chain: [],
    code_references: [],
    suggested_fix: "",
    tests_to_add: [],
    risk: "",
    recommended_action: "",
  };
  assert.ok(reportSchema.safeParse(base).success);
  assert.ok(!reportSchema.safeParse({ ...base, confidence: 140 }).success);
  assert.ok(!reportSchema.safeParse({ ...base, severity: "urgent" }).success);
});
