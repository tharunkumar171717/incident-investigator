import assert from "node:assert/strict";
import { test } from "node:test";
import { parseLogs, parseStackTrace } from "@/lib/agent/parse";

test("parses a Python traceback innermost-first", () => {
  const trace = `Traceback (most recent call last):
  File "/app/api/routes/orders.py", line 31, in post_order
    order = create_order(payload, user_id)
  File "/app/services/order_service.py", line 142, in create_order
    owner_id = user["id"]
TypeError: 'NoneType' object is not subscriptable`;
  const p = parseStackTrace(trace)!;
  assert.equal(p.runtime, "python");
  assert.equal(p.errorType, "TypeError");
  assert.match(p.errorMessage!, /NoneType/);
  assert.equal(p.frames[0].file, "/app/services/order_service.py");
  assert.equal(p.frames[0].line, 142);
  assert.equal(p.frames[0].func, "create_order");
  assert.equal(p.frames.length, 2);
});

test("parses a Node.js stack and drops node internals", () => {
  const trace = `TypeError: Cannot read properties of null (reading 'id')
    at createOrder (/srv/app/src/services/orders.js:42:23)
    at async handler (/srv/app/src/routes/orders.js:12:19)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)`;
  const p = parseStackTrace(trace)!;
  assert.equal(p.runtime, "node");
  assert.equal(p.errorType, "TypeError");
  assert.deepEqual(
    p.frames.map((f) => [f.func, f.line]),
    [
      ["createOrder", 42],
      ["handler", 12],
    ],
  );
});

test("parses Java frames", () => {
  const p = parseStackTrace(`java.lang.NullPointerException: user is null
\tat com.shop.OrderService.create(OrderService.java:88)
\tat com.shop.OrderController.post(OrderController.java:30)`)!;
  assert.equal(p.runtime, "java");
  assert.equal(p.errorType, "java.lang.NullPointerException");
  assert.equal(p.frames[0].file, "OrderService.java");
  assert.equal(p.frames[0].line, 88);
});

test("returns an empty parse for unrecognisable traces and null for empty input", () => {
  assert.equal(parseStackTrace("   "), null);
  const p = parseStackTrace("something went wrong somewhere")!;
  assert.equal(p.frames.length, 0);
  assert.equal(p.runtime, "unknown");
});

test("parses plain and JSON log lines", () => {
  const logs = parseLogs(`2026-10-06T14:05:12Z INFO orders request start
2026-10-06 14:05:12,431 ERROR orders POST /api/orders 500

{"level":"warn","msg":"slow query","time":"2026-10-06T14:05:13Z","service":"db"}`);
  assert.equal(logs.length, 3);
  assert.equal(logs[0].level, "info");
  assert.equal(logs[1].level, "error");
  assert.equal(logs[1].line_no, 2);
  assert.ok(logs[1].logged_at?.startsWith("2026-10-06T14:05:12"));
  assert.equal(logs[2].level, "warn");
  assert.equal(logs[2].source, "db");
  assert.equal(logs[2].message, "slow query");
  assert.equal(logs[2].line_no, 4);
});
