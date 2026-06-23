// Repository interface — keeps the swap to any store a one-file change.
// SQLite impl below stores one row per record as (id, json) in a per-collection table.
// Uses Node's built-in `node:sqlite` (no native build — works in locked-down enterprise envs).
// Loaded via createRequire so bundlers/transformers (Vite under Vitest) don't try to statically
// resolve `node:sqlite`, which is too new for some builtin lists — at runtime it's a native require.
import { createRequire } from 'node:module';
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = InstanceType<typeof DatabaseSync>; // type alias merges with the value above

export interface Repository<T extends { id: string }> {
  getAll(): T[];
  getById(id: string): T | undefined;
  insert(item: T): T;
  update(id: string, patch: Partial<T>): T;
  clear(): void;
}

export const COLLECTIONS = [
  'entities',
  'fundingRequests',
  'vaultPositions',
  'creditLines',
  'forecasts',
  'radarSignals',
  'investments',
  'auditEvents',
  'scheduledFlows',
  'meta',
] as const;
export type Collection = (typeof COLLECTIONS)[number];

class SqliteRepository<T extends { id: string }> implements Repository<T> {
  constructor(
    private db: DatabaseSync,
    private table: Collection,
  ) {
    this.db.exec(`CREATE TABLE IF NOT EXISTS ${this.table} (id TEXT PRIMARY KEY, json TEXT NOT NULL)`);
  }
  getAll(): T[] {
    const rows = this.db.prepare(`SELECT json FROM ${this.table}`).all() as { json: string }[];
    return rows.map((r) => JSON.parse(r.json) as T);
  }
  getById(id: string): T | undefined {
    const row = this.db.prepare(`SELECT json FROM ${this.table} WHERE id = ?`).get(id) as
      | { json: string }
      | undefined;
    return row ? (JSON.parse(row.json) as T) : undefined;
  }
  insert(item: T): T {
    this.db
      .prepare(`INSERT OR REPLACE INTO ${this.table} (id, json) VALUES (?, ?)`)
      .run(item.id, JSON.stringify(item));
    return item;
  }
  update(id: string, patch: Partial<T>): T {
    const current = this.getById(id);
    if (!current) throw new Error(`${this.table}/${id} not found`);
    const next = { ...current, ...patch, id } as T;
    this.insert(next);
    return next;
  }
  clear(): void {
    this.db.exec(`DELETE FROM ${this.table}`);
  }
}

export interface Repos {
  db: DatabaseSync;
  repo<T extends { id: string }>(c: Collection): Repository<T>;
  clearAll(): void;
}

let singleton: Repos | null = null;

export function getRepos(file = 'reduit.sqlite'): Repos {
  if (singleton) return singleton;
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  const cache = new Map<Collection, SqliteRepository<any>>();
  singleton = {
    db,
    repo<T extends { id: string }>(c: Collection): Repository<T> {
      if (!cache.has(c)) cache.set(c, new SqliteRepository<T>(db, c));
      return cache.get(c)! as Repository<T>;
    },
    clearAll() {
      for (const c of COLLECTIONS) this.repo(c).clear();
    },
  };
  return singleton;
}
