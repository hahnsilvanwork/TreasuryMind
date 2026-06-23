// C1/C2/C3 — 7-day internal liquidity line (XLS-66). broker=HQ, borrower=subsidiary, HQ first-loss
// cover. Demo economics are trivial (interest/fees 0) so early-close payoff = principal exactly.
// Cover invariant enforced identically in sim & live: CoverAvailable ≥ CoverRateMinimum × principal.
import { Router, type Router as RouterType } from 'express';
import type { Entity, CreditLine, VaultPosition } from '@reduit/shared';
import { add, sub, gte } from '@reduit/shared';
import { getRepos } from '../db/repository.js';
import { nextId } from '../lib/ids.js';
import { now } from '../lib/clock.js';
import { emit } from '../services/audit.js';
import { submit } from '../xrpl/submit.js';
import { COVER_RATE_MINIMUM, coverFor, meetsCoverMinimum } from '../lib/creditMath.js';

export const creditRouter: RouterType = Router();

const HQ_ID = 'ent_hq_ch';
const VAULT_ID = 'vp_hq_001';

const repos = getRepos();
const lines = () => repos.repo<CreditLine>('creditLines');
const entities = () => repos.repo<Entity>('entities');
const vaultRepo = () => repos.repo<VaultPosition>('vaultPositions');

function maturity(termDays: number): string {
  const d = new Date(now());
  d.setUTCDate(d.getUTCDate() + termDays);
  return d.toISOString();
}

// dynamic overdue: past maturity and still active
function withStatus(cl: CreditLine): CreditLine {
  if (cl.status === 'Active' && now() > cl.maturity_date) return { ...cl, status: 'Overdue' };
  return cl;
}

creditRouter.get('/credit-lines', (_req, res) => res.json(lines().getAll().map(withStatus)));

// C1 — originate: post first-loss cover, then create the loan from pooled liquidity
creditRouter.post('/credit-lines/create', async (req, res) => {
  const { borrower_entity_id, principal, term_days } = req.body ?? {};
  const borrower = entities().getById(borrower_entity_id);
  if (!borrower) return res.status(404).json({ error: 'unknown borrower_entity_id' });
  if (!principal) return res.status(400).json({ error: 'principal required' });

  const v = vaultRepo().getById(VAULT_ID)!;
  if (!gte(v.available, principal)) return res.status(409).json({ error: 'vault.available < principal (cover invariant)' });

  const cover = coverFor(principal);
  if (!meetsCoverMinimum(cover, principal)) return res.status(409).json({ error: 'cover below CoverRateMinimum' });

  const hq = entities().getById(HQ_ID)!;
  // post cover (LoanBrokerCoverDeposit) then create loan (LoanSet) — both Devnet, sim by default
  let coverTx, loanTx;
  try {
    coverTx = await submit({ method: 'LoanBrokerCoverDeposit', network: 'devnet', signer: 'broker', fields: { cover } });
    loanTx = await submit({ method: 'LoanSet', network: 'devnet', signer: 'broker', fields: { borrower: borrower.wallet_address, principal, term_days: term_days ?? 7, cover } });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }

  entities().update(hq.id, { balance: sub(hq.balance, cover) });
  vaultRepo().update(VAULT_ID, { available: sub(v.available, principal), locked: add(v.locked, principal) });
  entities().update(borrower.id, { balance: add(borrower.balance, principal) });

  const cl: CreditLine = {
    id: nextId('creditLines', 'cl_'),
    borrower_entity_id,
    principal,
    outstanding: principal,
    term_days: term_days ?? 7,
    maturity_date: maturity(term_days ?? 7),
    cover_available: cover,
    status: 'Active',
    source: loanTx.source,
    network: loanTx.network,
    loan_id: loanTx.loanId ?? null,
  };
  lines().insert(cl);
  emit({ entity_id: borrower.id, action_type: 'CreditLineCreated', actor: 'treasury', detail: { principal, cover, coverRateMinimum: COVER_RATE_MINIMUM, maturity: cl.maturity_date, explorerUrl: loanTx.explorerUrl, coverTx: coverTx.txHash }, policy_decision: null, tx_hash: loanTx.txHash, source: loanTx.source, network: loanTx.network });
  res.status(201).json(cl);
});

// C2 — early full close via LoanPay + tfLoanFullPayment (payoff = principal, interest 0)
creditRouter.post('/credit-lines/repay', async (req, res) => {
  const { id } = req.body ?? {};
  const cl = lines().getById(id);
  if (!cl) return res.status(404).json({ error: 'unknown credit line' });
  if (cl.status === 'Repaid' || cl.status === 'Closed') return res.status(409).json({ error: `already ${cl.status}` });

  const payoff = cl.outstanding; // interest/fees 0 → payoff = principal
  let tx;
  try {
    tx = await submit({ method: 'LoanPay', network: 'devnet', signer: 'broker', fields: { id, amount: payoff, loan_id: cl.loan_id ?? null } });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }

  const v = vaultRepo().getById(VAULT_ID)!;
  const borrower = entities().getById(cl.borrower_entity_id)!;
  const hq = entities().getById(HQ_ID)!;
  vaultRepo().update(VAULT_ID, { available: add(v.available, payoff), locked: sub(v.locked, payoff) });
  entities().update(borrower.id, { balance: sub(borrower.balance, payoff) });
  entities().update(hq.id, { balance: add(hq.balance, cl.cover_available) }); // cover released

  const updated = lines().update(id, { outstanding: '0.00', status: 'Repaid' });
  emit({ entity_id: cl.borrower_entity_id, action_type: 'CreditLineRepaid', actor: 'treasury', detail: { payoff, coverReleased: cl.cover_available, explorerUrl: tx.explorerUrl }, policy_decision: null, tx_hash: tx.txHash, source: tx.source, network: tx.network });
  res.json(updated);
});

// C3 — impair then clear (LoanManage) — turns "what about defaults?" into a shown capability
creditRouter.post('/credit-lines/impair', async (req, res) => {
  const { id } = req.body ?? {};
  const cl = lines().getById(id);
  if (!cl) return res.status(404).json({ error: 'unknown credit line' });
  let tx;
  try {
    tx = await submit({ method: 'LoanManage', network: 'devnet', signer: 'broker', fields: { id, action: 'impair', loan_id: cl.loan_id ?? null } });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
  const updated = lines().update(id, { status: 'Impaired' });
  emit({ entity_id: cl.borrower_entity_id, action_type: 'CreditLineImpaired', actor: 'broker', detail: { coverAbsorbs: cl.cover_available }, policy_decision: null, tx_hash: tx.txHash, source: tx.source, network: tx.network });
  res.json(updated);
});

creditRouter.post('/credit-lines/clear-impairment', async (req, res) => {
  const { id } = req.body ?? {};
  const cl = lines().getById(id);
  if (!cl) return res.status(404).json({ error: 'unknown credit line' });
  let tx;
  try {
    tx = await submit({ method: 'LoanManage', network: 'devnet', signer: 'broker', fields: { id, action: 'clear', loan_id: cl.loan_id ?? null } });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
  const updated = lines().update(id, { status: 'Active' });
  emit({ entity_id: cl.borrower_entity_id, action_type: 'CreditLineImpairmentCleared', actor: 'broker', detail: {}, policy_decision: null, tx_hash: tx.txHash, source: tx.source, network: tx.network });
  res.json(updated);
});
