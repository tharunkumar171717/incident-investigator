// Applies supabase/migrations/*.sql in order, once each, using DATABASE_URL.
// Same approach as live-location-tracker's `npm run migrate`; every migration
// is also idempotent, so it can be pasted into the Supabase SQL editor instead.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

process.loadEnvFile?.(".env.local");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set (see .env.example). Use the session pooler on port 5432.");
  process.exit(1);
}

const dir = path.join(process.cwd(), "supabase", "migrations");
const client = new pg.Client({
  connectionString: url,
  ssl: process.env.DB_SSL === "false" ? false : { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false" },
  connectionTimeoutMillis: 15_000,
});

await client.connect();
try {
  await client.query(`
    create table if not exists public.incident_investigator_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    );
    alter table public.incident_investigator_migrations enable row level security;
  `);
  const { rows } = await client.query<{ name: string }>("select name from public.incident_investigator_migrations");
  const applied = new Set(rows.map((r) => r.name));
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip   ${file}`);
      continue;
    }
    const sql = await readFile(path.join(dir, file), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into public.incident_investigator_migrations (name) values ($1)", [file]);
      await client.query("commit");
      console.log(`apply  ${file}`);
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  }
} finally {
  await client.end();
}
