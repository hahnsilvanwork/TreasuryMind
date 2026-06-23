// Deterministic seed — resets SQLite and loads seed.json. Idempotent (INSERT OR REPLACE).
// Run: pnpm seed   (or pnpm --filter backend seed)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getRepos, COLLECTIONS, type Collection } from '../db/repository.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function seed(): void {
  const data = JSON.parse(readFileSync(join(__dirname, 'seed.json'), 'utf8')) as Record<
    string,
    { id: string }[]
  >;
  const repos = getRepos();
  repos.clearAll();
  for (const [key, rows] of Object.entries(data)) {
    if (!COLLECTIONS.includes(key as Collection)) {
      console.warn(`[seed] skipping unknown collection "${key}"`);
      continue;
    }
    const repo = repos.repo(key as Collection);
    for (const row of rows) repo.insert(row);
    console.log(`[seed] ${key}: ${rows.length}`);
  }
  console.log('[seed] done.');
}

// run when invoked directly
if (process.argv[1] && process.argv[1].endsWith('seed.ts')) seed();
