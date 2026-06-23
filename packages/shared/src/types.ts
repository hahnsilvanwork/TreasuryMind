// Shared contract — imported by backend, agent, and frontend.
// The "golden rule": the AuditEvent shape is identical whether an action was LIVE or SIMULATED.

// ── primitives ───────────────────────────────────────────────────
/** Money is ALWAYS a decimal string, e.g. "500000.00". Never a JS number. See money.ts. */
export type Money = string;

export type Network = 'testnet' | 'devnet';
export type Source = 'LIVE' | 'SIMULATED';

/** UI mode badge per panel (per-network, per-method — never a global flip, D4). */
export type ModeBadge = 'LIVE_TESTNET' | 'LIVE_DEVNET' | 'SIMULATED' | 'PLANNED';

export interface Asset {
  code: string; // "RLUSD"
  issuer: string | null;
  isEquivalent: boolean; // true on the Devnet RLUSD-equivalent stand-in
  vault_token_type: 'MPT' | 'TrustLine' | null;
}

// ── entities ─────────────────────────────────────────────────────
export type EntityRole = 'HQ' | 'Subsidiary';

export interface Entity {
  id: string; // ent_hq_ch | ent_brz | ent_deu | ent_sgp
  legal_name: string;
  country: string; // CH | BR | DE | SG
  role: EntityRole;
  wallet_address: string;
  status: 'Active' | 'Suspended';
  balance: Money;
  operating_buffer: Money;
  deposit_auth: boolean;
}

export type FundingRequestStatus =
  | 'Draft' | 'PendingApproval' | 'Approved' | 'Submitted' | 'Settled' | 'Failed';

export interface FundingRequest {
  id: string;
  /** the entity that NEEDS the funds (destination of the transfer). */
  requester_entity_id: string;
  /** the entity the funds come FROM. null ⇒ defaults to HQ at execute time.
   *  Set by the treasurer or the advisor AI to fund from any group entity, not just HQ. */
  source_entity_id: string | null;
  amount: Money;
  purpose: string;
  due_date: string; // ISO-8601
  urgency: 'Low' | 'Medium' | 'High';
  status: FundingRequestStatus;
  tx_hash: string | null;
  source: Source;
  network: Network | null;
}

export interface VaultPosition {
  id: string;
  owner_entity_id: string;
  vault_id: string;
  deposited: Money;
  shares: Money;
  available: Money;
  locked: Money;
}

export type CreditLineStatus = 'Active' | 'Repaid' | 'Overdue' | 'Closed' | 'Impaired';

export interface CreditLine {
  id: string;
  borrower_entity_id: string;
  principal: Money;
  outstanding: Money;
  term_days: number;
  maturity_date: string;
  cover_available: Money;
  status: CreditLineStatus;
  source: Source;
  network: Network | null;
  /** On-chain Loan object ID from XLS-66 LoanSet (null when simulated). */
  loan_id?: string | null;
}

export interface ForecastSnapshot {
  id: string;
  entity_id: string;
  forecast_horizon_days: number;
  projected_min_balance: Money;
  operating_buffer: Money;
  generated_at: string;
}

export interface CreditRadarSignal {
  id: string;
  entity_id: string;
  projected_cash_stress_score: number; // 0–4
  inputs: Record<string, string>;
  generated_at: string;
}

// ── Investment Allocator (D6 / InvestmentPosition) ───────────────
export type InvestmentStatus = 'Proposed' | 'Active' | 'Matured' | 'Redeemed';

export interface InvestmentPosition {
  id: string;
  principal: Money;
  asset: Asset;
  apr: number; // e.g. 0.035
  openedAt: string;
  maturesAt: string;
  status: InvestmentStatus;
  expectedYield: Money;
  source: Source;
}

// ── Policy & audit ───────────────────────────────────────────────
export type PolicyOutcome = 'ALLOW' | 'BLOCK' | 'APPROVAL_REQUIRED';

export interface PolicyDecision {
  outcome: PolicyOutcome;
  matched_rule: string;
  checks: { name: string; passed: boolean }[];
  rationale: string;
}

export interface AuditEvent {
  id: string; // ae_000042
  entity_id: string | null;
  action_type: string;
  actor: string; // human user id | agent module name
  detail: Record<string, unknown>;
  policy_decision: PolicyDecision | null;
  tx_hash: string | null;
  source: Source;
  network: Network | null;
  created_at: string;
}
