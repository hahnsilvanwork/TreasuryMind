// Funding-request lifecycle + RLUSD settlement (Demo Path A, M1–M3).
// Draft/PendingApproval -> Approved -> Submitted -> Settled/Failed.
import { Router, type Router as RouterType } from 'express';
import type { Entity, FundingRequest } from '@reduit/shared';
import { add, sub, gte } from '@reduit/shared';
import { getRepos } from '../db/repository.js';
import { nextId } from '../lib/ids.js';
import { now } from '../lib/clock.js';
import { emit } from '../services/audit.js';
import { evaluate } from '../policy/policyEngine.js';
import { submit } from '../xrpl/submit.js';

export const fundingRouter: RouterType = Router();

const repos = getRepos();
const entities = () => repos.repo<Entity>('entities');
const requests = () => repos.repo<FundingRequest>('fundingRequests');

const HQ_ID = 'ent_hq_ch';

// list
fundingRouter.get('/funding-requests', (_req, res) => res.json(requests().getAll()));

// B1 — create a funding request
fundingRouter.post('/entities/request-funding', (req, res) => {
  const { requester_entity_id, source_entity_id, amount, purpose, due_date, urgency } = req.body ?? {};
  const requester = entities().getById(requester_entity_id);
  if (!requester) return res.status(404).json({ error: 'unknown requester_entity_id' });
  if (!amount) return res.status(400).json({ error: 'amount required' });
  if (source_entity_id && !entities().getById(source_entity_id))
    return res.status(404).json({ error: 'unknown source_entity_id' });

  const fr: FundingRequest = {
    id: nextId('fundingRequests', 'fr_'),
    requester_entity_id,
    source_entity_id: source_entity_id ?? null,
    amount,
    purpose: purpose ?? '',
    due_date: due_date ?? now(),
    urgency: urgency ?? 'Medium',
    status: 'PendingApproval',
    tx_hash: null,
    source: 'SIMULATED',
    network: null,
  };
  requests().insert(fr);
  emit({
    entity_id: requester_entity_id,
    action_type: 'FundingRequestCreated',
    actor: requester_entity_id,
    detail: { amount, purpose: fr.purpose, urgency: fr.urgency },
    policy_decision: null,
    tx_hash: null,
    source: 'SIMULATED',
    network: null,
  });
  res.status(201).json(fr);
});

// B2a — approve
fundingRouter.post('/treasury/approve-request', (req, res) => {
  const { id, approved_by } = req.body ?? {};
  const fr = requests().getById(id);
  if (!fr) return res.status(404).json({ error: 'unknown funding request' });
  if (fr.status !== 'PendingApproval')
    return res.status(409).json({ error: `cannot approve from status ${fr.status}` });

  const decision = evaluate({
    action: 'transfer',
    amount: fr.amount,
    destinationAllowlisted: true,
    approvedBy: approved_by ?? 'treasury',
  });
  const updated = requests().update(id, { status: 'Approved' });
  emit({
    entity_id: fr.requester_entity_id,
    action_type: 'FundingRequestApproved',
    actor: approved_by ?? 'treasury',
    detail: { amount: fr.amount },
    policy_decision: decision,
    tx_hash: null,
    source: 'SIMULATED',
    network: null,
  });
  res.json(updated);
});

// B2b / X1 — execute the transfer: real RLUSD Payment on Testnet via the submit() seam
fundingRouter.post('/treasury/execute-transfer', async (req, res) => {
  const { id } = req.body ?? {};
  const fr = requests().getById(id);
  if (!fr) return res.status(404).json({ error: 'unknown funding request' });
  if (fr.status !== 'Approved')
    return res.status(409).json({ error: `cannot execute from status ${fr.status}` });

  // source defaults to HQ but can be any group entity (inter-country funding, set by treasurer/AI)
  const source = entities().getById(fr.source_entity_id ?? HQ_ID);
  const dest = entities().getById(fr.requester_entity_id)!;
  if (!source) return res.status(404).json({ error: 'unknown source_entity_id' });
  if (source.id === dest.id) return res.status(400).json({ error: 'source and destination are the same' });

  // policy + source-liquidity guard
  const decision = evaluate({ action: 'transfer', amount: fr.amount, destinationAllowlisted: true });
  if (decision.outcome === 'BLOCK' || !gte(source.balance, fr.amount)) {
    const reason = decision.outcome === 'BLOCK' ? 'blocked by policy' : 'source has insufficient balance';
    requests().update(id, { status: 'Failed' });
    emit({
      entity_id: fr.requester_entity_id, action_type: 'FundingTransferBlocked', actor: 'PolicyEngine',
      detail: { amount: fr.amount, from: source.id, to: dest.id, reason }, policy_decision: decision,
      tx_hash: null, source: 'SIMULATED', network: null,
    });
    return res.status(403).json({ error: reason, decision });
  }

  requests().update(id, { status: 'Submitted' });

  try {
    const result = await submit({
      method: 'Payment',
      network: 'testnet',
      sourceEntityId: source.id,
      fields: { from: source.wallet_address, to: dest.wallet_address, amount: fr.amount, currency: 'RLUSD' },
    });

    // move money (same for live & sim — the ledger is authoritative when live; we mirror for the UI)
    entities().update(source.id, { balance: sub(source.balance, fr.amount) });
    entities().update(dest.id, { balance: add(dest.balance, fr.amount) });

    const settled = requests().update(id, {
      status: 'Settled',
      tx_hash: result.txHash,
      source: result.source,
      network: result.network,
    });
    emit({
      entity_id: fr.requester_entity_id,
      action_type: 'FundingSettled',
      actor: 'treasury',
      detail: { amount: fr.amount, explorerUrl: result.explorerUrl, from: source.id, to: dest.id },
      policy_decision: decision,
      tx_hash: result.txHash,
      source: result.source,
      network: result.network,
    });
    res.json({ request: settled, result });
  } catch (e) {
    requests().update(id, { status: 'Failed' });
    emit({
      entity_id: fr.requester_entity_id, action_type: 'FundingFailed', actor: 'treasury',
      detail: { amount: fr.amount, error: (e as Error).message }, policy_decision: decision,
      tx_hash: null, source: 'SIMULATED', network: null,
    });
    res.status(502).json({ error: 'settlement failed', detail: (e as Error).message });
  }
});

// Direct inter-country transfer (no request workflow) — powers "open a country and send/pull funds".
// Any group entity can be the source; the source signs its own Payment when live.
fundingRouter.post('/treasury/transfer', async (req, res) => {
  const { from_entity_id, to_entity_id, amount, purpose } = req.body ?? {};
  const source = entities().getById(from_entity_id);
  const dest = entities().getById(to_entity_id);
  if (!source) return res.status(404).json({ error: 'unknown from_entity_id' });
  if (!dest) return res.status(404).json({ error: 'unknown to_entity_id' });
  if (source.id === dest.id) return res.status(400).json({ error: 'source and destination are the same' });
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'amount must be > 0' });

  const decision = evaluate({ action: 'transfer', amount, destinationAllowlisted: true });
  if (decision.outcome === 'BLOCK' || !gte(source.balance, amount)) {
    const reason = decision.outcome === 'BLOCK' ? 'blocked by policy' : 'source has insufficient balance';
    emit({
      entity_id: dest.id, action_type: 'TransferBlocked', actor: 'treasury',
      detail: { amount, from: source.id, to: dest.id, reason }, policy_decision: decision,
      tx_hash: null, source: 'SIMULATED', network: null,
    });
    return res.status(403).json({ error: reason, decision });
  }

  try {
    const result = await submit({
      method: 'Payment',
      network: 'testnet',
      sourceEntityId: source.id,
      fields: { from: source.wallet_address, to: dest.wallet_address, amount, currency: 'RLUSD' },
    });
    entities().update(source.id, { balance: sub(source.balance, amount) });
    entities().update(dest.id, { balance: add(dest.balance, amount) });
    emit({
      entity_id: dest.id, action_type: 'TransferSettled', actor: 'treasury',
      detail: { amount, purpose: purpose ?? '', from: source.id, to: dest.id, explorerUrl: result.explorerUrl },
      policy_decision: decision, tx_hash: result.txHash, source: result.source, network: result.network,
    });
    res.json({ result, from: source.id, to: dest.id, amount });
  } catch (e) {
    emit({
      entity_id: dest.id, action_type: 'TransferFailed', actor: 'treasury',
      detail: { amount, from: source.id, to: dest.id, error: (e as Error).message },
      policy_decision: decision, tx_hash: null, source: 'SIMULATED', network: null,
    });
    res.status(502).json({ error: 'settlement failed', detail: (e as Error).message });
  }
});
