import "server-only";
import { z } from "zod";
import { readText, normalizeRepoPath, type Workspace } from "@/lib/github/workspace";
import { defineTool, ToolInputError } from "./types";
import { basename, escapeRegExp, globToRegExp, languageFor, numberLines, truncate } from "./util";

// Small per-process cache so repeated searches don't re-read every file.
const contentCache = new Map<string, string | null>();
const CACHE_LIMIT = 4000;

async function cachedText(ws: Workspace, rel: string): Promise<string | null> {
  const key = `${ws.root}\0${rel}`;
  if (contentCache.has(key)) return contentCache.get(key)!;
  const text = await readText(ws, rel);
  if (contentCache.size > CACHE_LIMIT) contentCache.clear();
  contentCache.set(key, text);
  return text;
}

export async function fileLines(ws: Workspace, rel: string): Promise<string[]> {
  const path = normalizeRepoPath(ws, rel);
  const text = await cachedText(ws, path);
  if (text === null) {
    const similar = ws.files.filter((f) => basename(f) === basename(path)).slice(0, 5);
    throw new ToolInputError(
      `File not found or not a text file: ${path}.` + (similar.length ? ` Did you mean: ${similar.join(", ")}?` : ""),
    );
  }
  return text.split(/\r?\n/);
}

function filterFiles(ws: Workspace, pathPrefix?: string, glob?: string): string[] {
  const prefix = pathPrefix?.replace(/^\.?\/+/, "").replace(/\/+$/, "");
  const re = glob ? globToRegExp(glob) : null;
  return ws.files.filter((f) => (!prefix || f === prefix || f.startsWith(`${prefix}/`)) && (!re || re.test(f)));
}

export const listRepositoryFiles = defineTool({
  name: "list_repository_files",
  description:
    "List file paths in the repository snapshot (dependency, build and binary files are excluded). Use path_prefix and/or a glob such as '**/*.py' or 'routes/*' to narrow results.",
  kind: "read",
  needsRepo: true,
  schema: z.object({
    path_prefix: z.string().optional().describe("directory to list, e.g. 'src/services'"),
    glob: z.string().optional().describe("glob filter, e.g. '**/*order*'"),
    limit: z.number().int().min(1).max(400).optional(),
  }),
  label: (i) => `Listing files${i.path_prefix ? ` in ${i.path_prefix}` : ""}${i.glob ? ` matching ${i.glob}` : ""}`,
  async run(input, ctx) {
    const ws = await ctx.workspace();
    const files = filterFiles(ws, input.path_prefix, input.glob);
    const limit = input.limit ?? 200;
    const shown = files.slice(0, limit);
    return {
      output:
        `${files.length} file(s)${files.length > limit ? `, showing first ${limit}` : ""}:\n` + (shown.join("\n") || "(none)"),
      summary: `${files.length} file(s) found`,
    };
  },
});

export const searchCode = defineTool({
  name: "search_code",
  description:
    "Search file contents in the repository (like grep). Returns matching lines with file path and line number. Literal search by default; set regex=true for a regular expression. Narrow with path_prefix or file_glob.",
  kind: "read",
  needsRepo: true,
  schema: z.object({
    query: z.string().min(1).max(300),
    regex: z.boolean().optional(),
    case_sensitive: z.boolean().optional(),
    path_prefix: z.string().optional(),
    file_glob: z.string().optional().describe("e.g. '**/*.ts'"),
    max_results: z.number().int().min(1).max(80).optional(),
  }),
  label: (i) => `Searching repository for "${truncate(i.query, 60)}"`,
  async run(input, ctx) {
    const ws = await ctx.workspace();
    let re: RegExp;
    try {
      re = new RegExp(input.regex ? input.query : escapeRegExp(input.query), input.case_sensitive ? "" : "i");
    } catch (e) {
      throw new ToolInputError(`Invalid regular expression: ${(e as Error).message}`);
    }
    const max = input.max_results ?? 40;
    const hits: string[] = [];
    const filesHit = new Set<string>();
    let total = 0;
    for (const file of filterFiles(ws, input.path_prefix, input.file_glob)) {
      if (ctx.signal.aborted) break;
      const text = await cachedText(ws, file);
      if (!text) continue;
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        if (!re.test(lines[i])) continue;
        total++;
        filesHit.add(file);
        if (hits.length < max) hits.push(`${file}:${i + 1}: ${truncate(lines[i].trim(), 220)}`);
      }
    }
    if (total === 0) {
      return { output: `No matches for ${JSON.stringify(input.query)}.`, summary: "No matches" };
    }
    return {
      output: `${total} match(es) in ${filesHit.size} file(s)${total > max ? `, showing ${max}` : ""}:\n${hits.join("\n")}`,
      summary: `${total} match(es) in ${filesHit.size} file(s): ${[...filesHit].slice(0, 3).map(basename).join(", ")}${filesHit.size > 3 ? "…" : ""}`,
    };
  },
});

export const readFile = defineTool({
  name: "read_file",
  description:
    "Read a range of lines from a file (max 300 lines per call), returned with line numbers. Read around the lines you care about rather than whole large files.",
  kind: "read",
  needsRepo: true,
  schema: z.object({
    path: z.string().min(1),
    start_line: z.number().int().min(1).optional(),
    end_line: z.number().int().min(1).optional(),
  }),
  label: (i) => `Reading ${i.path}${i.start_line ? `:${i.start_line}${i.end_line ? `-${i.end_line}` : ""}` : ""}`,
  async run(input, ctx) {
    const ws = await ctx.workspace();
    const lines = await fileLines(ws, input.path);
    const start = Math.min(input.start_line ?? 1, lines.length);
    const end = Math.min(input.end_line ?? start + 199, start + 299, lines.length);
    if (end < start) throw new ToolInputError("end_line must be >= start_line");
    const body = numberLines(lines.slice(start - 1, end), start);
    return {
      output: `${normalizeRepoPath(ws, input.path)} (lines ${start}-${end} of ${lines.length})\n${body}`,
      summary: `Read lines ${start}-${end} of ${lines.length}`,
    };
  },
});

export const getFile = defineTool({
  name: "get_file",
  description:
    "Get file metadata (language, line count) and the first 150 lines. Use read_file for specific ranges.",
  kind: "read",
  needsRepo: true,
  schema: z.object({ path: z.string().min(1) }),
  label: (i) => `Opening ${i.path}`,
  async run(input, ctx) {
    const ws = await ctx.workspace();
    const lines = await fileLines(ws, input.path);
    const path = normalizeRepoPath(ws, input.path);
    const head = numberLines(lines.slice(0, 150), 1);
    return {
      output: `path: ${path}\nlanguage: ${languageFor(path)}\nlines: ${lines.length}\n---\n${head}${lines.length > 150 ? "\n… (use read_file for more)" : ""}`,
      summary: `${lines.length} lines, ${languageFor(path)}`,
    };
  },
});

function definitionPatterns(symbol: string): RegExp[] {
  const s = escapeRegExp(symbol);
  return [
    new RegExp(`\\b(def|async\\s+def|class)\\s+${s}\\b`), // python
    new RegExp(`\\bfunction\\s*\\*?\\s+${s}\\b`), // js function
    new RegExp(`\\b(const|let|var)\\s+${s}\\s*=\\s*(async\\s*)?(\\(|function|[A-Za-z_$][\\w$]*\\s*=>)`), // js arrow
    new RegExp(`\\b(class|interface|type|enum|struct|trait|module)\\s+${s}\\b`),
    new RegExp(`\\bfunc\\s+(\\([^)]*\\)\\s*)?${s}\\s*\\(`), // go
    new RegExp(`\\bfn\\s+${s}\\b`), // rust
    new RegExp(`^\\s*(export\\s+)?(public|private|protected|static|async|\\s)*\\s*${s}\\s*\\([^)]*\\)\\s*(:\\s*[^={]+)?\\{`), // method
    new RegExp(`^\\s*${s}\\s*[:=]\\s*(async\\s*)?(function|\\()`), // object method / assignment
    new RegExp(`\\bdef\\s+(self\\.)?${s}\\b`), // ruby
  ];
}

export const findReferences = defineTool({
  name: "find_references",
  description:
    "Find where a symbol (function, class, variable) is defined and where it is used. Use this to follow call chains, e.g. from a route handler to the function that fails.",
  kind: "read",
  needsRepo: true,
  schema: z.object({
    symbol: z.string().min(1).max(120).regex(/^[A-Za-z_$][\w$.]*$/, "must be an identifier"),
    path_prefix: z.string().optional(),
    max_results: z.number().int().min(1).max(80).optional(),
  }),
  label: (i) => `Finding references to ${i.symbol}()`,
  async run(input, ctx) {
    const ws = await ctx.workspace();
    const symbol = input.symbol.split(".").pop()!;
    const word = new RegExp(`(^|[^\\w$])${escapeRegExp(symbol)}(?![\\w$])`);
    const defs = definitionPatterns(symbol);
    const definitions: string[] = [];
    const references: string[] = [];
    const max = input.max_results ?? 40;
    for (const file of filterFiles(ws, input.path_prefix)) {
      if (ctx.signal.aborted) break;
      const text = await cachedText(ws, file);
      if (!text || !text.includes(symbol)) continue;
      const lines = text.split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (!word.test(line)) continue;
        const entry = `${file}:${i + 1}: ${truncate(line.trim(), 200)}`;
        if (defs.some((d) => d.test(line))) definitions.push(entry);
        else if (references.length < max) references.push(entry);
      }
    }
    const out =
      `Definitions of ${symbol} (${definitions.length}):\n${definitions.join("\n") || "(none found)"}\n\n` +
      `References (${references.length}${references.length >= max ? "+" : ""}):\n${references.join("\n") || "(none found)"}`;
    return {
      output: out,
      summary: definitions.length
        ? `Defined at ${definitions[0].split(": ")[0]}; ${references.length} reference(s)`
        : `No definition found; ${references.length} reference(s)`,
    };
  },
});

export const repoTools = [listRepositoryFiles, searchCode, readFile, getFile, findReferences];
