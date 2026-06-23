import { describe, it, expect } from 'vitest';

// in-memory DB bound before the modules load; seed the canonical demo fixture for deterministic forecasts
const { getRepos } = await import('../db/repository.js');
getRepos(':memory:');
const { seed } = await import('../seed/seed.js');
seed();
const analyzer = await import('./analyzer.js');

describe('liquidity analyzer (AI #2 — deterministic core)', () => {
  it('maps every entity into a structured position', () => {
    const o = analyzer.overview();
    expect(o.positions).toHaveLength(4); // HQ + BR + DE + SG
    expect(o.totals.groupBalance).toBeTruthy();
    const brz = o.positions.find((p) => p.entity_id === 'ent_brz')!;
    expect(brz.status).toBe('deficit'); // Brazil dips below buffer in the seed
    expect(Number(brz.shortfall)).toBeGreaterThan(0);
  });

  it('funds the deficit from a surplus subsidiary (Germany) BEFORE drawing HQ', () => {
    const s = analyzer.suggestions();
    const toBrz = s.filter((x) => x.to_entity_id === 'ent_brz');
    expect(toBrz.length).toBeGreaterThan(0);
    // Germany has genuine surplus and must be used before HQ (the central reserve)
    expect(toBrz[0].from_entity_id).toBe('ent_deu');
    for (const move of toBrz) {
      expect(move.from_entity_id).not.toBe('ent_brz'); // never fund itself
      expect(Number(move.amount)).toBeGreaterThan(0);
    }
  });

  it('suggestions never exceed each donor capacity (no double-spend of the same surplus)', () => {
    const o = analyzer.overview();
    const s = analyzer.suggestions();
    const sentFrom: Record<string, number> = {};
    for (const m of s) sentFrom[m.from_entity_id] = (sentFrom[m.from_entity_id] ?? 0) + Number(m.amount);
    for (const [donor, sent] of Object.entries(sentFrom)) {
      const p = o.positions.find((x) => x.entity_id === donor)!;
      const cap = p.role === 'HQ' ? Number(p.balance) - Number(p.buffer) : Number(p.surplus);
      expect(sent).toBeLessThanOrEqual(cap + 0.001);
    }
  });
});
