const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
  py: "python", rb: "ruby", go: "go", rs: "rust", java: "java", kt: "kotlin", cs: "csharp",
  php: "php", swift: "swift", scala: "scala", c: "c", h: "c", cpp: "cpp", hpp: "cpp",
  sql: "sql", sh: "bash", bash: "bash", yml: "yaml", yaml: "yaml", json: "json", toml: "toml",
  md: "markdown", html: "html", css: "css", scss: "scss", vue: "vue", svelte: "svelte",
  dockerfile: "dockerfile", tf: "hcl", graphql: "graphql", prisma: "prisma",
};

export function languageFor(path: string): string {
  const base = path.split("/").pop()?.toLowerCase() ?? "";
  if (base === "dockerfile") return "dockerfile";
  const ext = base.includes(".") ? base.split(".").pop()! : "";
  return EXT_LANG[ext] ?? "text";
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… [truncated ${text.length - max} chars]`;
}

export function numberLines(lines: string[], start: number): string {
  const width = String(start + lines.length - 1).length;
  return lines.map((l, i) => `${String(start + i).padStart(width)} | ${l}`).join("\n");
}

/** Minimal glob: supports *, ** and ? against repo-relative paths. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  // A glob without a slash matches the basename anywhere.
  return glob.includes("/") ? new RegExp(`^${re}$`) : new RegExp(`(^|/)${re}$`);
}

export function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function shortSha(sha: string) {
  return sha.slice(0, 7);
}

export function basename(p: string) {
  return p.split("/").pop() ?? p;
}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new TimeoutError(`${what} timed out after ${Math.round(ms / 1000)}s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export class TimeoutError extends Error {}
