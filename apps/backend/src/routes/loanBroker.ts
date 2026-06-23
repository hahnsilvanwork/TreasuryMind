// POST /loan-broker/setup — one-time creation of the XLS-66 LoanBroker object on Devnet.
// Returns the loanBrokerId to store as LOAN_BROKER_ID_DEVNET in .env.
import { Router, type Router as RouterType } from 'express';
import { nativeLoanBrokerSet } from '../xrpl/loanOps.js';
import { resolveMode } from '../config.js';

export const loanBrokerRouter: RouterType = Router();

loanBrokerRouter.post('/loan-broker/setup', async (_req, res) => {
  if (resolveMode('devnet', 'LoanBrokerSet') !== 'live') {
    return res.status(400).json({
      error: 'DEVNET_LIVE is not enabled — set DEVNET_LIVE=true in .env before running setup.',
    });
  }
  try {
    const result = await nativeLoanBrokerSet();
    // Patch process.env immediately so subsequent calls in this process use the new ID
    // without needing a server restart (.env is also updated by the caller).
    if (result.loanBrokerId) {
      process.env.LOAN_BROKER_ID_DEVNET = result.loanBrokerId;
    }
    return res.json({
      ok: true,
      loanBrokerId: result.loanBrokerId,
      txHash: result.txHash,
      explorerUrl: result.explorerUrl,
      note: result.loanBrokerId
        ? `Add to .env: LOAN_BROKER_ID_DEVNET=${result.loanBrokerId}`
        : 'LoanBroker created but ID not found in AffectedNodes — check raw.',
      raw: result.raw,
    });
  } catch (e) {
    return res.status(500).json({ error: (e as Error).message });
  }
});

loanBrokerRouter.get('/loan-broker/status', (_req, res) => {
  const id = process.env.LOAN_BROKER_ID_DEVNET?.trim() || null;
  res.json({
    loanBrokerId: id,
    configured: Boolean(id),
    mode: resolveMode('devnet', 'LoanBrokerSet'),
  });
});
