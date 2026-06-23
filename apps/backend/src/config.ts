// Single source of truth for every guardrail number (caps, APR, KPI, pricing).
import { config as dotenvConfig } from 'dotenv';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = fileURLToPath(new URL('.', import.meta.url));
dotenvConfig({ path: resolve(__dirname, '../../../.env') });
import type { Network } from '@reduit/shared';

export const POLICY = {
  auto_sweep_threshold: 25_000, // per-action agent sweep cap (≤ this auto-executes)
  daily_spend_cap: 50_000, // cumulative agent daily cap
  hq_instant_transfer_cap: 1_000_000,
  demo_sweep_amount: 15_000, // the on-stage sweep (≤ threshold)
} as const;

export const ALLOCATOR = {
  sim_apr: 0.035, // 3.5%
  safety_margin: 10_000,
  auto_invest_max_amount: 25_000, // = sweep threshold
  auto_invest_max_tenor_days: 7,
  planning_horizon_days: 7,
  // Canonical demo reserve (D6/D7). In production this is DERIVED from AG1's forecast
  // (= max projected net outflow + operating buffer + expected credit-line drawdowns);
  // pinned here so the card matches the deck exactly: 500k − 300k − 10k = 190k investable.
  required_liquidity_reserve: 300_000,
} as const;

export const KPI = {
  BANK_BASELINE_SETTLEMENT_HOURS: 72, // CH→Brazil worst-case corridor (D7)
  XRPL_TARGET_SETTLEMENT_SECONDS: 30,
} as const;

export const BUSINESS = {
  saas_fee_chf_month: 3_500,
  tx_fee_bps: 5,
} as const;

// LIVE/SIM resolution per (network, method) — D4 per-method, per-network. Never a global flip.
// SimAdapter is the DEFAULT (D3). Testnet methods go LIVE only when LIVE_TESTNET=true is set in .env
// (i.e. after `pnpm provision` filled the wallet seeds and the liveAdapter is wired).
// XLS-65 VaultCreate/Deposit/Withdraw go LIVE on Devnet when DEVNET_LIVE=true (seeds required).
type LiveSim = 'live' | 'sim';
const FORCE_SIM = process.env.FORCE_SIM === 'true';
const LIVE_TESTNET = process.env.LIVE_TESTNET === 'true';
const DEVNET_LIVE = process.env.DEVNET_LIVE === 'true';

const TESTNET_LIVE_METHODS = new Set(['Payment', 'DepositPreauth', 'SetRegularKey']);
const DEVNET_LIVE_METHODS = new Set([
  // XLS-65
  'VaultCreate', 'VaultDeposit', 'VaultWithdraw',
  // XLS-66
  'LoanBrokerSet', 'LoanBrokerCoverDeposit', 'LoanSet', 'LoanPay', 'LoanManage',
]);

export function resolveMode(network: Network, method: string): LiveSim {
  if (FORCE_SIM) return 'sim';
  if (network === 'testnet' && LIVE_TESTNET && TESTNET_LIVE_METHODS.has(method)) return 'live';
  if (network === 'devnet' && DEVNET_LIVE && DEVNET_LIVE_METHODS.has(method)) return 'live';
  return 'sim';
}

// Render (and most PaaS) inject PORT; fall back to BACKEND_PORT for local dev.
export const PORT = Number(process.env.PORT ?? process.env.BACKEND_PORT ?? 3001);
// Restrict CORS to the deployed frontend origin in prod; open in dev when unset.
export const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN?.trim() || undefined;
