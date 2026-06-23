import { describe, it, expect, beforeEach } from 'vitest';
import type { VaultPosition } from '@reduit/shared';

// Bind the repository singleton to an in-memory DB BEFORE the allocator module loads, so its
// top-level getRepos() reuses it. Hence the dynamic imports (order matters) instead of static ones.
const { getRepos } = await import('../db/repository.js');
const repos = getRepos(':memory:');
const allocator = await import('./allocator.js');

const VAULT_ID = 'vp_hq_001';
const vault = () => repos.repo<VaultPosition>('vaultPositions');

function seedVault(available = '500000.00') {
  vault().insert({
    id: VAULT_ID, owner_entity_id: 'ent_hq_ch', vault_id: 'vault_main',
    deposited: available, shares: available, available, locked: '0.00',
  });
}

beforeEach(() => {
  repos.repo('investments').clear();
  seedVault();
});

describe('YieldAllocatorAgent', () => {
  it('computes investable surplus = available − reserve − safety margin', () => {
    const r = allocator.recommend();
    expect(r.liquidityFloor).toBe('310000.00'); // 300k + 10k
    expect(r.investableSurplus).toBe('190000.00'); // 500k − 300k − 10k
  });

  it('HARD-BLOCKS an allocation that would breach the liquidity floor', () => {
    const res = allocator.create('250000.00', 7); // 500k − 250k = 250k < 310k floor
    expect(res.ok).toBe(false);
    expect(res.decision.outcome).toBe('BLOCK');
    expect(vault().getById(VAULT_ID)!.available).toBe('500000.00'); // untouched
  });

  it('auto-invests a small, short allocation and moves money available → locked', () => {
    const res = allocator.create('20000.00', 7);
    expect(res.ok).toBe(true);
    expect(res.decision.outcome).toBe('ALLOW');
    const v = vault().getById(VAULT_ID)!;
    expect(v.available).toBe('480000.00');
    expect(v.locked).toBe('20000.00');
  });

  it('requires approval for a long tenor, and proceeds once approved', () => {
    const blocked = allocator.create('20000.00', 14); // tenor > 7d
    expect(blocked.ok).toBe(false);
    expect(blocked.decision.outcome).toBe('APPROVAL_REQUIRED');
    expect(vault().getById(VAULT_ID)!.available).toBe('500000.00'); // nothing moved

    const approved = allocator.create('20000.00', 14, 'cfo');
    expect(approved.ok).toBe(true);
    expect(vault().getById(VAULT_ID)!.available).toBe('480000.00');
  });

  it('redeem returns principal + yield to available and frees the locked principal', () => {
    const created = allocator.create('20000.00', 7);
    expect(created.ok).toBe(true);
    const pos = created.position!;

    const redeemed = allocator.redeem(pos.id);
    expect(redeemed?.status).toBe('Redeemed');

    const v = vault().getById(VAULT_ID)!;
    // available = 500k − 20k (locked) + (20k principal + yield) = 500k + yield
    expect(v.locked).toBe('0.00');
    expect(Number(v.available)).toBeGreaterThan(500000); // original + accrued yield
  });
});
