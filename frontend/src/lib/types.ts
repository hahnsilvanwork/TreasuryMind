export type ExecutionStatus = 'ON_CHAIN' | 'SIMULATED' | 'FALLBACK' | 'FAILED';

/** Dashboard navigation tabs (rendered by Header). */
export type Tab = 'liquidity' | 'vault' | 'xrpl' | 'risk' | 'audit' | 'suppliers';

export interface HealthResponse {
  status: string;
  checks?: {
    xrpl?: { status: string; build_version?: string; complete_ledgers?: string };
    ai?: string;
    wallets_funded?: string;
  };
  rlusd_token_live?: boolean;
  rlusd_trustlines?: number;
  xls65_vault_onchain?: boolean;
  xls85_token_escrow?: boolean;
  xrpl_network?: string;
  execution_layer?: string;
}

export interface Subsidiary {
  id: string;
  name: string;
  location: string;
  flag: string;
  currency: string;
  rlusd_balance: number;
  threshold_min: number;
  threshold_max: number;
  wallet_address: string | null;
  status: 'surplus' | 'deficit' | 'normal';
  shortfall: number;
  excess: number;
}

export interface CorporateVault {
  id: string;
  name: string;
  total_capacity: number;
  available: number;
  committed: number;
  deposited_total?: number;
  apy: number;
  wallet_address: string | null;
  xrpl_primitive?: string;
  active_credit_lines?: number;
}

export interface ActiveCreditLine {
  id: string;
  borrower: string;
  lender: string;
  amount: number;
  currency: string;
  term_days: number;
  rate_pct: number;
  xrpl_instrument: string;
  status: 'active' | 'active_simulated' | 'repaid' | 'overdue' | 'defaulted';
  execution_status?: ExecutionStatus;
  simulated: boolean;
  tx_hash: string | null;
  timestamp: string;
  due_date?: string;
  approved_by: string;
  risk_score?: number;
  risk_level?: 'low' | 'medium' | 'high';
  repaid_at?: string;
  defaulted_at?: string;
  // XLS-85 TokenEscrow repayment settlement
  repayment_mode?: string;
  repayment_tx_hash?: string;
  repayment_escrow_explorer_url?: string | null;
  repayment_release_explorer_url?: string | null;
  repayment_vault_explorer_url?: string | null;
}

export interface BalancesResponse {
  subsidiaries: Record<string, Subsidiary>;
  vault: CorporateVault;
  active_credit_lines: ActiveCreditLine[];
  total_rlusd: number;
  network_rlusd: number;
  timestamp: string;
}

/** One actionable option returned by the AI Agent */
export interface TreasuryOption {
  type: 'direct_transfer' | 'vault_credit';
  label: string;
  from: string;
  to: string;
  amount: number;
  reasoning: string;
  fx_saving_usd: number;
  settlement_time: string;
  risk_level: 'low' | 'medium' | 'high';
  confidence: number;
  xrpl_instrument: string;
  xrpl_primitive: string;
  pros: string[];
  cons: string[];
  // Vault credit specific
  term_days?: number;
  rate_pct?: number;
}

export interface AnalysisResponse {
  problem_detected: boolean;
  severity: 'critical' | 'high' | 'medium' | 'low';
  problem_summary: string;
  affected_subsidiaries: string[];
  options: TreasuryOption[];
  market_context: string;
  compliance_note: string;
  ai_mode?: 'claude' | 'rule_based';
}

export interface PolicyCheck {
  name: string;
  status: 'passed' | 'failed' | 'warning';
  reason: string;
}

export type PolicyDecision = 'APPROVED' | 'APPROVED_WITH_WARNING' | 'BLOCKED';
export type ApprovalLevel = 'AUTO' | 'TREASURY_MANAGER' | 'CFO_REQUIRED';

export interface PolicyResult {
  approved: boolean;
  policy_decision: PolicyDecision;
  approval_level: ApprovalLevel;
  requires_human_approval: boolean;
  requires_cfo_approval: boolean;
  checks: PolicyCheck[];
  blocking_reasons: string[];
  warning_reasons: string[];
  risk_level: string;
  adjusted_rate_multiplier: number;
  decision_summary: string;
  policy_version: string;
  validated_at: string;
}

export interface RiskResult {
  entity_id: string;
  entity_name: string;
  risk_score: number;
  risk_level: 'low' | 'medium' | 'high';
  reasons: string[];
}

export interface RiskScoresResponse {
  scores: Record<string, RiskResult>;
  timestamp: string;
  methodology: string;
}

export interface ScenarioInfo {
  id: string;
  name: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
}

export interface ScenarioResult {
  scenario_id: string;
  scenario_name: string;
  description: string;
  severity: string;
  applied_at: string;
  deltas: Record<string, number>;
  affected_entities: string[];
  new_deficits: string[];
  before: Record<string, number>;
  after: Record<string, number>;
  recommendation: string;
}

export interface Transfer {
  id: string;
  audit_id?: string;
  from: string;
  to: string;
  amount: number;
  currency: string;
  action_type?: 'direct_transfer' | 'vault_credit';
  timestamp: string;
  tx_hash: string;
  execution_status?: ExecutionStatus;
  execution_mode?: string;
  status: string;
  simulated?: boolean;
  fx_saving: number;
  reason: string;
  approved_by?: string;
  explorer_url?: string;
  xrpl_instrument?: string;
  ai_confidence?: number;
  policy_decision?: PolicyDecision;
  approval_level?: ApprovalLevel;
  risk_score?: number;
  risk_level?: string;
}

// ── Vault / Wallets / Policy endpoints ───────────────────────────────────────

export interface VaultOnchainInfo {
  vault_id?: string;
  assets_total?: string;
  assets_available?: string;
  assets_maximum?: string;
  share_mpt_id?: string;
  owner?: string;
  explorer_url?: string;
}

export interface VaultResponse extends Omit<CorporateVault, 'active_credit_lines'> {
  active_credit_lines_count: number;
  active_credit_lines: ActiveCreditLine[];
  expected_interest_income: number;
  vault_onchain?: boolean;
  onchain?: VaultOnchainInfo;
  lending_primitive?: string;
  accounting_note?: string;
}

export interface WalletInfo {
  name: string;
  address: string;
  explorer_url: string;
  balance?: number;
  onchain_rlusd?: number | null;
  status?: string;
  available?: number;
  committed?: number;
}

export interface WalletsResponse {
  subsidiaries: Record<string, WalletInfo>;
  corporate_vault: WalletInfo;
  issuer?: {
    name: string;
    address: string;
    explorer_url: string;
    currency_code: string;
    trustlines: number;
  };
  network: string;
  rlusd_token_live?: boolean;
  settlement_asset: string;
  note?: string;
}

export interface PolicyResponse {
  policy: Record<string, number | string>;
  whitelisted_entities: string[];
  approval_levels: Record<string, string>;
  version: string;
}

// ── Supplier Liquidity Network (Experimental) ────────────────────────────────

export type SupplierTrustStatus = 'VERIFIED' | 'PENDING_REVIEW' | 'BLOCKED';
export type SupplierCredentialStatus = 'ACTIVE' | 'MISSING' | 'EXPIRED';
export type SupplierApprovalStatus = 'NOT_REQUESTED' | 'PENDING_APPROVAL' | 'APPROVED' | 'BLOCKED' | 'EXECUTED';
export type SupplierRecommendedAction = 'APPROVE' | 'APPROVE_WITH_WARNING' | 'BLOCK';

export interface Supplier {
  id: string;
  name: string;
  short_name: string;
  type: string;
  location: string;
  flag: string;
  wallet_address: string | null;
  requested_liquidity: number;
  purpose: string;
  trust_status: SupplierTrustStatus;
  credential_status: SupplierCredentialStatus;
  risk_score: number;
  risk_level: 'low' | 'medium' | 'high';
  credit_limit: number;
  current_exposure: number;
  allowed_currencies: string[];
  max_term_days: number;
  last_review_date: string;
  strategic_importance: string;
  approval_status: SupplierApprovalStatus;
}

export interface SuppliersResponse {
  suppliers: Supplier[];
  total: number;
  verified: number;
  pending: number;
  blocked: number;
  total_requested: number;
  approved_exposure: number;
  timestamp: string;
}

export interface SupplierAnalysis {
  supplier_id: string;
  supplier_name: string;
  ai_mode: string;
  summary: string;
  recommended_decision: SupplierRecommendedAction;
  reasoning: string;
  risk_explanation: string;
  suggested_amount: number;
  suggested_term_days: number;
  suggested_interest_rate: number;
  required_approval_level: string;
  pros: string[];
  cons: string[];
  policy_notes: string;
  policy: PolicyResult;
  timestamp: string;
}

export interface SupplierCreditLine {
  id: string;
  supplier_id: string;
  supplier_name: string;
  supplier_type: string;
  amount: number;
  currency: string;
  term_days: number;
  interest_rate: number;
  risk_score_at_issuance: number;
  risk_level: string;
  policy_decision: PolicyDecision;
  approval_level: ApprovalLevel;
  status: 'ACTIVE' | 'REPAID' | 'DEFAULTED' | 'BLOCKED';
  xrpl_tx_hash: string | null;
  execution_mode: string;
  execution_status: ExecutionStatus;
  simulated: boolean;
  explorer_url: string | null;
  audit_id: string;
  created_at: string;
  due_date: string;
  repaid_at: string | null;
  approved_by: string;
  memo: string;
}

export interface SupplierApprovalResult {
  success: boolean;
  audit_id: string;
  action_type: 'supplier_credit';
  credit_line: SupplierCreditLine;
  transfer: Transfer;
  xrpl: {
    tx_hash: string;
    simulated: boolean;
    execution_status: ExecutionStatus;
    execution_mode: string;
    explorer_url: string | null;
  };
  policy: PolicyResult;
  vault_available: number;
}

export interface AuditEvent {
  id: string;
  type: string;
  timestamp: string;
  details: Record<string, unknown>;
}

export interface AuditResponse {
  audit_log: AuditEvent[];
  transfer_history: Transfer[];
  total_transfers: number;
  total_fx_saved: number;
  direct_transfers?: number;
  vault_credits?: number;
  active_credit_lines?: ActiveCreditLine[];
}

export interface ApprovalResult {
  success: boolean;
  action_type: 'direct_transfer' | 'vault_credit';
  audit_id?: string;
  transfer: Transfer;
  xrpl: {
    tx_hash: string;
    from_address: string;
    to_address: string;
    explorer_url: string | null;
    simulated?: boolean;
    execution_status?: ExecutionStatus;
    execution_mode?: string;
    memo_reference?: string;
    network?: string;
  };
  credit_line: ActiveCreditLine | null;
  fx_saving_usd: number;
  updated_balances: Record<string, number>;
  policy?: PolicyResult;
  risk?: RiskResult;
}
