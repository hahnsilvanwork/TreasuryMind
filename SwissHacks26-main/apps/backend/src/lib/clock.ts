// Single injectable clock. Domain timestamps use the sim clock (anchor + offset) so demo data
// and forecasts are deterministic; advancing the clock is how we trigger overdue lines and the
// forecast breach that fires the agent sweep.
import { getRepos } from '../db/repository.js';

interface ClockMeta {
  id: string;
  anchorDate?: string;
  simClockOffsetSeconds?: number;
}

function meta(): ClockMeta {
  return (
    getRepos().repo<ClockMeta>('meta').getById('clock') ?? { id: 'clock', simClockOffsetSeconds: 0 }
  );
}

/** Current demo time as ISO-8601 (anchor + sim offset). */
export function now(): string {
  const m = meta();
  const base = m.anchorDate ? new Date(m.anchorDate).getTime() : Date.now();
  return new Date(base + (m.simClockOffsetSeconds ?? 0) * 1000).toISOString();
}

/** Advance the demo clock; returns the new now(). */
export function advanceClock(seconds: number): string {
  const repos = getRepos();
  const m = meta();
  repos
    .repo<ClockMeta>('meta')
    .insert({ ...m, id: 'clock', simClockOffsetSeconds: (m.simClockOffsetSeconds ?? 0) + seconds });
  return now();
}
