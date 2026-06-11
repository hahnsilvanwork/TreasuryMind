import type {
  BalancesResponse,
  AnalysisResponse,
  AuditResponse,
  ApprovalResult,
  RiskScoresResponse,
  ScenarioResult,
  ScenarioInfo,
  ActiveCreditLine,
  SuppliersResponse,
  SupplierAnalysis,
  SupplierApprovalResult,
  SupplierCreditLine,
  VaultResponse,
  WalletsResponse,
  PolicyResponse,
  HealthResponse,
} from './types';

const BASE = '/api';

// Reads should respond fast; writes may legitimately take long (an escrowed
// repayment settles three validated XRPL transactions, ~60s worst case).
const GET_TIMEOUT_MS = 30_000;
const POST_TIMEOUT_MS = 120_000;

async function request<T>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE}${path}`, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
    return await res.json();
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs / 1000}s — backend busy or still starting`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function get<T>(path: string): Promise<T> {
  return request<T>(path, { cache: 'no-store' }, GET_TIMEOUT_MS);
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(
    path,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    POST_TIMEOUT_MS,
  );
}

export const api = {
  getHealth: () => get<HealthResponse>('/health'),
  getBalances: () => get<BalancesResponse>('/balances'),
  analyze: () => get<AnalysisResponse>('/analyze'),
  getAudit: () => get<AuditResponse>('/audit'),
  getWallets: () => get<WalletsResponse>('/wallets'),
  getFxRates: () => get<unknown>('/fx-rates'),
  getRiskScores: () => get<RiskScoresResponse>('/risk-scores'),
  getScenarios: () => get<{ scenarios: ScenarioInfo[] }>('/scenarios'),
  getVault: () => get<VaultResponse>('/vault'),
  getCreditLines: () => get<{ active: ActiveCreditLine[]; count: number; total_committed: number }>('/credit-lines'),
  getPolicy: () => get<PolicyResponse>('/policy'),

  vaultDeposit: (params: { subsidiary_id: string; amount: number; approved_by?: string }) =>
    post<{ success: boolean; deposit: unknown; xrpl: { tx_hash: string; simulated?: boolean; execution_status?: string }; vault: unknown; subsidiary_balance: number }>('/vault/deposit', params),

  approveTransfer: (params: {
    from_id: string;
    to_id: string;
    amount: number;
    action_type: 'direct_transfer' | 'vault_credit';
    reasoning: string;
    term_days?: number;
    rate_pct?: number;
    approved_by?: string;
    confidence?: number;
  }) => post<ApprovalResult>('/approve', params),

  repayCreditLine: (creditLineId: string, params?: { approved_by?: string }) =>
    post<{ success: boolean; credit_line: ActiveCreditLine; xrpl: unknown; vault_available: number }>(
      `/credit-lines/${creditLineId}/repay`,
      params ?? {}
    ),

  defaultCreditLine: (creditLineId: string, params?: { approved_by?: string }) =>
    post<{ success: boolean; credit_line: ActiveCreditLine; vault_available: number; loss_recognized: number }>(
      `/credit-lines/${creditLineId}/default`,
      params ?? {}
    ),

  triggerScenario: (scenarioId: string) =>
    post<ScenarioResult>('/scenario/liquidity-shock', { scenario_id: scenarioId }),

  // Supplier Liquidity Network (Experimental)
  getSuppliers: () => get<SuppliersResponse>('/suppliers'),
  analyzeSupplier: (supplierId: string) => post<SupplierAnalysis>(`/suppliers/${supplierId}/analyze`, {}),
  approveSupplierCredit: (supplierId: string, params?: { amount?: number; term_days?: number; approved_by?: string }) =>
    post<SupplierApprovalResult>(`/suppliers/${supplierId}/approve-credit`, params ?? {}),
  getSupplierCreditLines: () => get<{ credit_lines: SupplierCreditLine[]; total: number; active: number }>('/supplier-credit-lines'),
  repaySupplierCredit: (creditLineId: string) =>
    post<{ success: boolean; credit_line: SupplierCreditLine; vault_available: number }>(
      `/supplier-credit-lines/${creditLineId}/repay`, {}
    ),
};

export function formatRLUSD(amount: number): string {
  if (amount >= 1_000_000) {
    return `${(amount / 1_000_000).toFixed(2)}M`;
  }
  if (amount >= 1_000) {
    return `${(amount / 1_000).toFixed(0)}K`;
  }
  return amount.toFixed(0);
}

export function formatFull(amount: number): string {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

export function truncateHash(hash: string, chars = 8): string {
  if (!hash || hash.length <= chars * 2) return hash;
  return `${hash.slice(0, chars)}...${hash.slice(-chars)}`;
}

export function timeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
