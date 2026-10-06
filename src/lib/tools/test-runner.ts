import "server-only";
import { spawn } from "node:child_process";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileChange } from "@/lib/db/types";
import { scratchCopy, type Workspace } from "@/lib/github/workspace";
import { truncate } from "./util";

export interface CommandResult {
  command: string;
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  durationMs: number;
}

const FORBIDDEN = /[;&|<>`$\\\n\r]/;

/** Splits a configured command into argv. No shell is ever involved. */
export function splitCommand(cmd: string): string[] {
  if (FORBIDDEN.test(cmd)) {
    throw new Error("Test/setup commands may not contain shell operators (; & | < > ` $ \\). Configure a single command, e.g. `npm test` or `pytest -q`.");
  }
  const argv: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cmd))) argv.push(m[1] ?? m[2] ?? m[3]);
  if (!argv.length) throw new Error("Empty command.");
  return argv;
}

function run(argv: string[], cwd: string, timeoutMs: number, signal: AbortSignal): Promise<CommandResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    // Minimal environment: server secrets (GitHub/Supabase/AI keys) are NOT passed through.
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      shell: false,
      env: {
        PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
        HOME: cwd,
        LANG: "C.UTF-8",
        CI: "true",
        NODE_ENV: "test",
        PYTHONDONTWRITEBYTECODE: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    const append = (b: Buffer) => {
      if (out.length < 200_000) out += b.toString("utf8");
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    let timedOut = false;
    const kill = () => child.kill("SIGKILL");
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs);
    signal.addEventListener("abort", kill, { once: true });
    const done = (exitCode: number | null, extra = "") => {
      clearTimeout(timer);
      signal.removeEventListener("abort", kill);
      resolve({
        command: argv.join(" "),
        exitCode,
        output: truncate(out + extra, 20_000),
        timedOut,
        durationMs: Date.now() - started,
      });
    };
    child.on("error", (err) => done(null, `\n[failed to start: ${err.message}]`));
    child.on("close", (code) => done(code, timedOut ? `\n[killed after ${Math.round(timeoutMs / 1000)}s timeout]` : ""));
  });
}

export async function runTestsInSandbox(opts: {
  workspace: Workspace;
  changes: FileChange[];
  setupCommand: string | null;
  testCommand: string;
  target: string | null;
  timeoutMs: number;
  signal: AbortSignal;
}): Promise<{ setup: CommandResult | null; test: CommandResult | null; error?: string }> {
  const dir = await scratchCopy(opts.workspace);
  try {
    for (const change of opts.changes) {
      const abs = path.resolve(dir, change.path);
      if (path.relative(dir, abs).startsWith("..")) throw new Error(`Refusing to write outside the sandbox: ${change.path}`);
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, change.updated, "utf8");
    }
    let setup: CommandResult | null = null;
    if (opts.setupCommand) {
      setup = await run(splitCommand(opts.setupCommand), dir, opts.timeoutMs, opts.signal);
      if (setup.exitCode !== 0) return { setup, test: null, error: "Setup command failed" };
    }
    const argv = splitCommand(opts.testCommand);
    if (opts.target) {
      if (!/^[\w./@-]+(::[\w.\[\]-]+)?$/.test(opts.target) || opts.target.startsWith("-") || opts.target.includes("..")) {
        return { setup, test: null, error: `Invalid test target "${opts.target}". Use a repo-relative test file path.` };
      }
      try {
        await stat(path.resolve(dir, opts.target.split("::")[0]));
      } catch {
        return { setup, test: null, error: `Test target not found: ${opts.target}` };
      }
      argv.push(opts.target);
    }
    return { setup, test: await run(argv, dir, opts.timeoutMs, opts.signal) };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
