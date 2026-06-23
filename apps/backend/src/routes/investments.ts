// IA6 — Investment Allocator endpoints: recommend / create / redeem / list.
import { Router, type Router as RouterType } from 'express';
import { recommend, create, redeem, list } from '../agents/allocator.js';

export const investmentsRouter: RouterType = Router();

investmentsRouter.get('/investments', (_req, res) => res.json(list()));
investmentsRouter.get('/investments/recommend', (_req, res) => res.json(recommend()));

investmentsRouter.post('/investments/create', (req, res) => {
  const { amount, tenorDays, approved_by } = req.body ?? {};
  if (!amount || !tenorDays) return res.status(400).json({ error: 'amount and tenorDays required' });
  const result = create(amount, Number(tenorDays), approved_by ?? null);
  if (!result.ok) {
    const code = result.decision.outcome === 'BLOCK' ? 403 : 409;
    return res.status(code).json({ error: result.decision.outcome, decision: result.decision });
  }
  res.status(201).json(result);
});

investmentsRouter.post('/investments/redeem', (req, res) => {
  const { id } = req.body ?? {};
  const updated = redeem(id);
  if (!updated) return res.status(404).json({ error: 'unknown or already redeemed' });
  res.json(updated);
});
