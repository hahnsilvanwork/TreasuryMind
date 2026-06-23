// Deterministic, human-readable, sequential ids (fr_001, ae_000042) — not UUIDs — so logs and
// screenshots stay readable and reproducible.
import { getRepos, type Collection } from '../db/repository.js';

export function nextId(collection: Collection, prefix: string, pad = 3): string {
  const rows = getRepos().repo<{ id: string }>(collection).getAll();
  let max = 0;
  for (const r of rows) {
    const m = r.id.match(/(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(pad, '0')}`;
}
