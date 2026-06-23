// Typed fetch against the backend. Shares @reduit/shared types — no schema drift.
import type {
  Entity,
  FundingRequest,
  CreditLine,
  VaultPosition,
  InvestmentPosition,
  AuditEvent,
  CreditRadarSignal,
  Source,
  Network,
} from '@reduit/shared';

// Dev: Vite proxies '/api/*' → backend root. Prod: point at the deployed backend via VITE_API_URL
// (e.g. the Render URL set in Vercel env); falls back to same-origin if unset.
const BASE = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? (import.meta.env.DEV ? '/api' : '');

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json() as Promise<T>;
}
async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`${path} → ${res.status}`), { status: res.status, body: json });
  return json as T;
}

// ── derived shapes (backend-specific, not in @reduit/shared) ─────
export interface DashboardSummary {
  entities: Entity[];
  kpi: { bankBaselineHours: number; xrplTargetSeconds: number };
  business: { saas_fee_chf_month: number; tx_fee_bps: number };
  now: string;
}
export interface ForecastResult {
  entity_id: string;
  horizonDays: number;
  opening: string;
  projectedMin: string;
  ending: string;
  buffer: string;
  belowBuffer: boolean;
  shortfall: string;
  surplus: string;
  timeline: { date: string; balance: string }[];
}
export interface WatchEntry {
  entity_id: string;
  projectedMin: string;
  buffer: string;
  status: 'deficit' | 'surplus' | 'ok';
  shortfall: string;
  surplus: string;
  sweepable: boolean;
  autoSweepEligible: boolean;
}
export interface Recommendation {
  id: string;
  entity_id: string;
  agent_module: string;
  recommended_action: string;
  amount: string;
  source_entity_id: string | null;
  requires_approval: boolean;
  rationale: string;
}
export interface SweepResult {
  entity_id: string;
  amount: string;
  outcome: string;
  txHash: string | null;
  source: Source;
}
export interface Tranche {
  amount: string;
  tenorDays: number;
  maturesAt: string;
  tier: 'AUTO' | 'APPROVAL_REQUIRED';
  expectedYield: string;
}
export interface AllocatorRecommendation {
  available: string;
  requiredLiquidityReserve: string;
  safetyMargin: string;
  liquidityFloor: string;
  investableSurplus: string;
  apr: number;
  tranches: Tranche[];
  blockedExample: { amount: string; reason: string };
  card: string;
}
export interface SubmitResult {
  source: Source;
  network: Network | null;
  txHash: string | null;
  explorerUrl: string | null;
  validated: boolean;
}

export interface AdvisorQuestion { id: string; question: string; options: string[] }
export interface AdvisorOption {
  id: string; title: string;
  kind: 'fund' | 'sweep' | 'invest' | 'credit_line' | 'hold';
  source_entity_id: string | null;
  entity_id: string | null; amount: string | null; tenorDays: number | null;
  rationale: string; recommended: boolean;
}
export interface AdvisorResult { summary: string; options: AdvisorOption[]; source: 'ai' | 'rule-based' }
export interface AdvisorExecuteResult {
  ok: boolean; message: string;
  settlement?: { fromCode: string; toCode: string; amount: string; txHash: string | null; source: Source; network: Network | null };
}

// Liquidity Analyzer (AI #2)
export interface AnalyzerPosition {
  entity_id: string; country: string; role: string;
  balance: string; buffer: string; projectedMin: string;
  status: 'deficit' | 'surplus' | 'ok'; shortfall: string; surplus: string;
}
export interface AnalyzerSuggestion {
  from_entity_id: string; to_entity_id: string; amount: string;
  urgency: 'low' | 'medium' | 'high'; rationale: string;
}
export interface AnalyzerResult {
  positions: AnalyzerPosition[];
  totals: { groupBalance: string; vaultAvailable: string; vaultLocked: string; totalDeficit: string; totalSurplus: string };
  suggestions: AnalyzerSuggestion[];
  narrative: string;
  source: 'ai' | 'rule-based';
  generatedAt: string;
}

export interface AppConfig {
  paymentTestnet: 'live' | 'sim';
  vaultTestnet: 'live' | 'sim';
  vaultDevnet: 'live' | 'sim';
  loanDevnet: 'live' | 'sim';
  loanBrokerConfigured: boolean;
  ai: { enabled: boolean; provider: string; model: string };
  now: string;
}

export const api = {
  config: () => get<AppConfig>('/config'),
  advisorQuestions: () => get<AdvisorQuestion[]>('/advisor/questions'),
  advisorRecommend: (answers: Record<string, string>) => post<AdvisorResult>('/advisor/recommend', { answers }),
  advisorExecute: (option: AdvisorOption) => post<AdvisorExecuteResult>('/advisor/execute', { option }),
  dashboard: () => get<DashboardSummary>('/dashboard/summary'),
  entities: () => get<Entity[]>('/entities'),
  audit: () => get<AuditEvent[]>('/audit'),
  advanceClock: (seconds: number) => post<{ now: string }>('/demo/advance-clock', { seconds }),

  // funding
  fundingRequests: () => get<FundingRequest[]>('/funding-requests'),
  requestFunding: (b: { requester_entity_id: string; amount: string; purpose: string; urgency: string; source_entity_id?: string | null }) =>
    post<FundingRequest>('/entities/request-funding', b),
  approve: (id: string, approved_by: string) => post<FundingRequest>('/treasury/approve-request', { id, approved_by }),
  execute: (id: string) => post<{ request: FundingRequest; result: SubmitResult }>('/treasury/execute-transfer', { id }),
  // direct inter-country transfer (any source → any destination)
  transfer: (from_entity_id: string, to_entity_id: string, amount: string, purpose?: string) =>
    post<{ result: SubmitResult; from: string; to: string; amount: string }>('/treasury/transfer', { from_entity_id, to_entity_id, amount, purpose }),

  // liquidity analyzer (AI #2)
  analyzer: () => get<AnalyzerResult>('/analyzer'),
  analyzerOverview: () => get<Omit<AnalyzerResult, 'suggestions' | 'narrative' | 'source'>>('/analyzer/overview'),

  // agents
  forecast: () => get<ForecastResult[]>('/agent/forecast'),
  radar: () => get<CreditRadarSignal[]>('/agent/radar'),
  watchlist: () => get<WatchEntry[]>('/agent/watchlist'),
  recommendations: () => get<Recommendation[]>('/agent/recommendations'),
  runSweep: () => post<SweepResult[]>('/agent/run-sweep'),

  // vault + credit
  vault: () => get<VaultPosition & { sharePrice: string }>('/vault'),
  vaultDeposit: (owner_entity_id: string, amount: string) => post('/vault/deposit', { owner_entity_id, amount }),
  creditLines: () => get<CreditLine[]>('/credit-lines'),
  createLine: (borrower_entity_id: string, principal: string, term_days = 7) =>
    post<CreditLine>('/credit-lines/create', { borrower_entity_id, principal, term_days }),
  repayLine: (id: string) => post<CreditLine>('/credit-lines/repay', { id }),
  impairLine: (id: string) => post<CreditLine>('/credit-lines/impair', { id }),
  clearImpair: (id: string) => post<CreditLine>('/credit-lines/clear-impairment', { id }),

  // allocator
  investments: () => get<InvestmentPosition[]>('/investments'),
  allocatorRecommend: () => get<AllocatorRecommendation>('/investments/recommend'),
  invest: (amount: string, tenorDays: number, approved_by?: string) =>
    post('/investments/create', { amount, tenorDays, approved_by }),
  redeem: (id: string) => post('/investments/redeem', { id }),
};
