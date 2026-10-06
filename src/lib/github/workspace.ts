import "server-only";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import { env } from "@/lib/env";
import type { RepoRef } from "./client";
import { GitHubError, toGitHubError } from "./errors";

/**
 * A read-only snapshot of a repository at one commit, extracted to local disk.
 * The agent searches and reads it with targeted tools; nothing is sent to the
 * model unless a tool returns it. Snapshots are cached per commit SHA.
 */
export interface Workspace {
  repo: RepoRef;
  sha: string;
  root: string;
  files: string[]; // repo-relative POSIX paths of indexable text files
}

const ROOT = path.join(os.tmpdir(), "incident-investigator", "workspaces");
const SKIP_DIRS = new Set([".git", "node_modules", "vendor", "dist", "build", ".next", "out", "target", "__pycache__", ".venv", "venv", "coverage", ".turbo", ".cache"]);
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|tgz|bz2|xz|7z|jar|war|class|so|dylib|dll|exe|bin|wasm|woff2?|ttf|otf|eot|mp[34]|mov|avi|lock|min\.js|map|pyc|o|a)$/i;
export const MAX_INDEXED_FILE_BYTES = 512 * 1024;

const inflight = new Map<string, Promise<Workspace>>();

export function workspaceKey(repo: RepoRef, sha: string) {
  return `${repo.owner}__${repo.name}__${sha}`.replace(/[^A-Za-z0-9._-]/g, "_");
}

export async function getWorkspace(repo: RepoRef, sha: string): Promise<Workspace> {
  const key = workspaceKey(repo, sha);
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = load(repo, sha, key).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function load(repo: RepoRef, sha: string, key: string): Promise<Workspace> {
  const dir = path.join(ROOT, key);
  const marker = path.join(dir, ".ii-ready");
  try {
    await stat(marker);
    return { repo, sha, root: path.join(dir, "src"), files: await indexFiles(path.join(dir, "src")) };
  } catch {
    // not cached yet
  }

  const tmp = `${dir}.tmp-${process.pid}-${Date.now()}`;
  await mkdir(path.join(tmp, "src"), { recursive: true });
  try {
    const archive = path.join(tmp, "repo.tar.gz");
    await download(repo, sha, archive);
    await tar.x({ file: archive, cwd: path.join(tmp, "src"), strip: 1 });
    await rm(archive, { force: true });
    await writeFile(path.join(tmp, ".ii-ready"), new Date().toISOString());
    await rm(dir, { recursive: true, force: true });
    await rename(tmp, dir);
  } catch (err) {
    await rm(tmp, { recursive: true, force: true });
    throw err;
  }
  return { repo, sha, root: path.join(dir, "src"), files: await indexFiles(path.join(dir, "src")) };
}

async function download(repo: RepoRef, sha: string, dest: string) {
  const maxBytes = env().MAX_REPO_ARCHIVE_MB * 1024 * 1024;
  let res: Response;
  try {
    // fetch follows GitHub's redirect to a short-lived codeload URL; the body is
    // streamed to disk so large archives are never buffered in memory.
    res = await fetch(`https://api.github.com/repos/${repo.owner}/${repo.name}/tarball/${sha}`, {
      headers: {
        ...(env().GITHUB_TOKEN ? { Authorization: `Bearer ${env().GITHUB_TOKEN}` } : {}),
        Accept: "application/vnd.github+json",
        "User-Agent": "incident-investigator",
      },
      signal: AbortSignal.timeout(120_000),
    });
  } catch (err) {
    throw toGitHubError(err, "download the repository archive");
  }
  if (!res.ok || !res.body) {
    throw toGitHubError({ status: res.status, message: res.statusText }, `download ${repo.owner}/${repo.name}@${sha.slice(0, 7)}`);
  }
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) {
    throw new GitHubError("repo_too_large", `Repository archive exceeds ${env().MAX_REPO_ARCHIVE_MB} MB (MAX_REPO_ARCHIVE_MB).`, 413);
  }

  let seen = 0;
  const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream);
  body.on("data", (chunk: Buffer) => {
    seen += chunk.length;
    if (seen > maxBytes) {
      body.destroy(new GitHubError("repo_too_large", `Repository archive exceeds ${env().MAX_REPO_ARCHIVE_MB} MB (MAX_REPO_ARCHIVE_MB).`, 413));
    }
  });
  await pipeline(body, createWriteStream(dest));
}

async function indexFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(rel: string) {
    const entries = await readdir(path.join(root, rel), { withFileTypes: true });
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) await walk(childRel);
      } else if (e.isFile() && !BINARY_EXT.test(e.name)) {
        out.push(childRel);
      }
    }
  }
  await walk("");
  return out.sort();
}

export class UnsafePathError extends Error {}

/** Resolves a repo-relative path inside the workspace, rejecting traversal. */
export function safePath(ws: Workspace, rel: string): string {
  const cleaned = rel.replace(/^\.?\/+/, "");
  const abs = path.resolve(ws.root, cleaned);
  const relative = path.relative(ws.root, abs);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new UnsafePathError(`Path "${rel}" is outside the repository.`);
  }
  return abs;
}

export function normalizeRepoPath(ws: Workspace, p: string): string {
  return path.relative(ws.root, safePath(ws, p)).split(path.sep).join("/");
}

export async function readText(ws: Workspace, rel: string): Promise<string | null> {
  const abs = safePath(ws, rel);
  try {
    const s = await stat(abs);
    if (!s.isFile() || s.size > MAX_INDEXED_FILE_BYTES * 4) return null;
    const buf = await readFile(abs);
    if (buf.includes(0)) return null; // binary
    return buf.toString("utf8");
  } catch {
    return null;
  }
}

/** Copies the snapshot to a scratch directory for running tests with a fix applied. */
export async function scratchCopy(ws: Workspace): Promise<string> {
  const { cp } = await import("node:fs/promises");
  const dir = path.join(os.tmpdir(), "incident-investigator", "runs", `${workspaceKey(ws.repo, ws.sha)}-${Date.now()}`);
  await mkdir(path.dirname(dir), { recursive: true });
  await cp(ws.root, dir, { recursive: true });
  return dir;
}
