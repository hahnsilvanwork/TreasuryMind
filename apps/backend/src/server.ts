import express from 'express';
import cors from 'cors';
import { getRepos } from './db/repository.js';
import { seed } from './seed/seed.js';
import { PORT, KPI, BUSINESS, resolveMode, FRONTEND_ORIGIN } from './config.js';
import type { Entity } from '@reduit/shared';
import { fundingRouter } from './routes/funding.js';
import { agentRouter } from './routes/agent.js';
import { investmentsRouter } from './routes/investments.js';
import { vaultRouter } from './routes/vault.js';
import { creditRouter } from './routes/creditLines.js';
import { loanBrokerRouter } from './routes/loanBroker.js';
import { advisorRouter } from './routes/advisor.js';
import { analyzerRouter } from './routes/analyzer.js';
import { list as auditList } from './services/audit.js';
import { advanceClock, now } from './lib/clock.js';
import { disconnectAll } from './xrpl/client.js';
import { aiInfo } from './ai/llm.js';

const app = express();
app.use(cors(FRONTEND_ORIGIN ? { origin: FRONTEND_ORIGIN } : undefined));
app.use(express.json());

const repos = getRepos();
// seed on boot if empty
if (repos.repo<Entity>('entities').getAll().length === 0) seed();

app.get('/health', (_req, res) => res.json({ ok: true, now: now() }));

// global mode indicator for the UI topbar (per-method resolution lives in config.ts)
app.get('/config', (_req, res) =>
  res.json({
    paymentTestnet: resolveMode('testnet', 'Payment'),
    vaultTestnet: resolveMode('testnet', 'VaultDeposit'),
    vaultDevnet: resolveMode('devnet', 'VaultDeposit'),
    loanDevnet: resolveMode('devnet', 'LoanSet'),
    loanBrokerConfigured: Boolean(process.env.LOAN_BROKER_ID_DEVNET?.trim()),
    ai: aiInfo(),
    now: now(),
  }),
);

app.get('/dashboard/summary', (_req, res) => {
  const entities = repos.repo<Entity>('entities').getAll();
  res.json({
    entities,
    kpi: {
      bankBaselineHours: KPI.BANK_BASELINE_SETTLEMENT_HOURS,
      xrplTargetSeconds: KPI.XRPL_TARGET_SETTLEMENT_SECONDS,
    },
    business: BUSINESS,
    now: now(),
  });
});

app.get('/entities', (_req, res) => res.json(repos.repo<Entity>('entities').getAll()));

// audit log (UI6) — optional ?entity_id= & ?action_type= filters
app.get('/audit', (req, res) =>
  res.json(
    auditList({
      entity_id: req.query.entity_id as string | undefined,
      action_type: req.query.action_type as string | undefined,
    }),
  ),
);

// demo clock control — advance time to trigger the forecast breach / overdue line
app.post('/demo/advance-clock', (req, res) => {
  const seconds = Number(req.body?.seconds ?? 86400);
  res.json({ now: advanceClock(seconds) });
});

// Funding flow (Path A, M1–M3): /entities/request-funding, /treasury/approve-request, /treasury/execute-transfer
app.use(fundingRouter);
// Agent layer (AG1–AG4): /agent/forecast, /radar, /watchlist, /recommendations, /run-sweep
app.use(agentRouter);
// Investment Allocator (IA6): /investments/recommend, /create, /redeem
app.use(investmentsRouter);
// Vault (V1, XLS-65): /vault, /vault/deposit, /vault/withdraw
app.use(vaultRouter);
// Credit lines (C1/C2/C3, XLS-66): /credit-lines/create, /repay, /impair, /clear-impairment
app.use(creditRouter);
// LoanBroker setup (one-time): POST /loan-broker/setup, GET /loan-broker/status
app.use(loanBrokerRouter);
// AI advisor: /advisor/questions, /advisor/recommend, /advisor/execute
app.use(advisorRouter);
// Liquidity analyzer (AI #2): /analyzer/overview, /analyzer/suggestions, /analyzer
app.use(analyzerRouter);

const server = app.listen(PORT, () => {
  console.log(`ReduitTreasuries backend on http://localhost:${PORT}`);
});

// close XRPL sockets cleanly so the process exits without hanging
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    server.close();
    disconnectAll().finally(() => process.exit(0));
  });
}
