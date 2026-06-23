// V1 — Pooled liquidity (XLS-65 Single Asset Vault). Deposit/withdraw with share math.
// One pool, two views: `available` is the shared liquidity the credit line + allocator draw on.
// First-deposit convention: shares 1:1; thereafter shares = amount / sharePrice (assets/shares).
import { Router, type Router as RouterType } from 'express';
import type { Entity, VaultPosition } from '@reduit/shared';
import { add, sub, gt } from '@reduit/shared';
import { getRepos } from '../db/repository.js';
import { emit } from '../services/audit.js';
import { submit } from '../xrpl/submit.js';
import { sharePrice, sharesForDeposit, sharesForWithdraw } from '../lib/vaultMath.js';
import { getXrpVaultInfo, getRlusdVaultInfo } from '../services/vaultService.js';
import { resolveMode } from '../config.js';

export const vaultRouter: RouterType = Router();

const VAULT_ID = 'vp_hq_001';
const repos = getRepos();
const vaultRepo = () => repos.repo<VaultPosition>('vaultPositions');
const entities = () => repos.repo<Entity>('entities');

vaultRouter.get('/vault', (_req, res) => {
  const v = vaultRepo().getById(VAULT_ID)!;
  res.json({ ...v, sharePrice: sharePrice(v).toFixed(6) });
});

// Live on-chain status for both XRP and RLUSD vaults.
// Returns real data from Devnet when DEVNET_LIVE=true, otherwise sim placeholders.
vaultRouter.get('/vault/live-status', async (_req, res) => {
  const mode = resolveMode('devnet', 'VaultDeposit');
  try {
    const [xrp, rlusd] = await Promise.all([
      getXrpVaultInfo().catch((e: Error) => ({ error: e.message })),
      getRlusdVaultInfo().catch((e: Error) => ({ error: e.message })),
    ]);
    res.json({ mode, xrp, rlusd });
  } catch (e) {
    res.status(502).json({ error: 'vault live-status failed', detail: (e as Error).message });
  }
});

// deposit surplus into the pool (e.g. Germany's swept surplus)
vaultRouter.post('/vault/deposit', async (req, res) => {
  const { owner_entity_id, amount } = req.body ?? {};
  const owner = entities().getById(owner_entity_id);
  if (!owner) return res.status(404).json({ error: 'unknown owner_entity_id' });
  if (!amount) return res.status(400).json({ error: 'amount required' });
  if (!gt(owner.balance, sub(amount, '0.01'))) return res.status(409).json({ error: 'insufficient balance' });

  const v = vaultRepo().getById(VAULT_ID)!;
  const newShares = sharesForDeposit(v, amount);

  try {
    const result = await submit({ method: 'VaultDeposit', network: 'devnet', sourceEntityId: owner_entity_id, fields: { amount } });
    entities().update(owner.id, { balance: sub(owner.balance, amount) });
    const updated = vaultRepo().update(VAULT_ID, {
      deposited: add(v.deposited, amount),
      shares: add(v.shares, newShares),
      available: add(v.available, amount),
    });
    emit({ entity_id: owner.id, action_type: 'VaultDeposit', actor: owner.id, detail: { amount, sharesMinted: newShares, explorerUrl: result.explorerUrl }, policy_decision: null, tx_hash: result.txHash, source: result.source, network: result.network });
    res.status(201).json({ vault: { ...updated, sharePrice: sharePrice(updated).toFixed(6) }, result });
  } catch (e) {
    res.status(502).json({ error: 'vault deposit failed', detail: (e as Error).message });
  }
});

// withdraw liquid funds from the pool back to an entity
vaultRouter.post('/vault/withdraw', async (req, res) => {
  const { owner_entity_id, amount } = req.body ?? {};
  const owner = entities().getById(owner_entity_id);
  if (!owner) return res.status(404).json({ error: 'unknown owner_entity_id' });
  const v = vaultRepo().getById(VAULT_ID)!;
  if (!gt(add(v.available, '0.01'), amount)) return res.status(409).json({ error: 'amount exceeds vault.available' });

  const burnShares = sharesForWithdraw(v, amount);
  try {
    const result = await submit({ method: 'VaultWithdraw', network: 'devnet', signer: 'vault', fields: { to: owner.wallet_address, amount } });
    const updated = vaultRepo().update(VAULT_ID, {
      deposited: sub(v.deposited, amount),
      shares: sub(v.shares, burnShares),
      available: sub(v.available, amount),
    });
    entities().update(owner.id, { balance: add(owner.balance, amount) });
    emit({ entity_id: owner.id, action_type: 'VaultWithdraw', actor: owner.id, detail: { amount, sharesBurned: burnShares }, policy_decision: null, tx_hash: result.txHash, source: result.source, network: result.network });
    res.json({ vault: { ...updated, sharePrice: sharePrice(updated).toFixed(6) }, result });
  } catch (e) {
    res.status(502).json({ error: 'vault withdrawal failed', detail: (e as Error).message });
  }
});
