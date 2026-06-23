import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import express from 'express';
import type { Entity } from '@reduit/shared';
import type { AddressInfo } from 'node:net';

// in-memory DB must bind before the router module loads (it grabs the singleton at import)
const { getRepos } = await import('../db/repository.js');
const repos = getRepos(':memory:');
const { fundingRouter } = await import('./funding.js');

const app = express();
app.use(express.json());
app.use(fundingRouter);
const server = app.listen(0);
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
afterAll(() => server.close());

const ent = (id: string, balance: string): Entity => ({
  id, legal_name: id, country: 'XX', role: id === 'ent_hq_ch' ? 'HQ' : 'Subsidiary',
  wallet_address: `r${id}`, status: 'Active', balance, operating_buffer: '0.00', deposit_auth: true,
});

function seedEntities() {
  const e = repos.repo<Entity>('entities');
  e.insert(ent('ent_deu', '450000.00')); // source (Germany, surplus)
  e.insert(ent('ent_brz', '150000.00')); // destination (Brazil)
}

const post = (path: string, body: unknown) =>
  fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

beforeEach(() => {
  repos.repo('entities').clear();
  repos.repo('auditEvents').clear();
  seedEntities();
});

describe('inter-country transfer (POST /treasury/transfer)', () => {
  it('moves balance from any source to any destination (Germany → Brazil)', async () => {
    const res = await post('/treasury/transfer', { from_entity_id: 'ent_deu', to_entity_id: 'ent_brz', amount: '50000.00' });
    expect(res.status).toBe(200);
    const e = repos.repo<Entity>('entities');
    expect(e.getById('ent_deu')!.balance).toBe('400000.00'); // 450k − 50k
    expect(e.getById('ent_brz')!.balance).toBe('200000.00'); // 150k + 50k
  });

  it('blocks when the source has insufficient balance (no balance moved)', async () => {
    const res = await post('/treasury/transfer', { from_entity_id: 'ent_brz', to_entity_id: 'ent_deu', amount: '999999.00' });
    expect(res.status).toBe(403);
    const e = repos.repo<Entity>('entities');
    expect(e.getById('ent_brz')!.balance).toBe('150000.00'); // unchanged
    expect(e.getById('ent_deu')!.balance).toBe('450000.00'); // unchanged
  });

  it('rejects a transfer to the same entity', async () => {
    const res = await post('/treasury/transfer', { from_entity_id: 'ent_deu', to_entity_id: 'ent_deu', amount: '1000.00' });
    expect(res.status).toBe(400);
  });

  it('writes a TransferSettled audit event with from/to', async () => {
    await post('/treasury/transfer', { from_entity_id: 'ent_deu', to_entity_id: 'ent_brz', amount: '1000.00' });
    const events = repos.repo<{ id: string; action_type: string; detail: Record<string, unknown> }>('auditEvents').getAll();
    const settled = events.find((e) => e.action_type === 'TransferSettled');
    expect(settled).toBeTruthy();
    expect(settled!.detail.from).toBe('ent_deu');
    expect(settled!.detail.to).toBe('ent_brz');
  });
});
