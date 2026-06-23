// THE submit() seam — every chain action goes through here so LIVE↔SIM is a flag flip (D4).
// Both adapters return the SAME SubmitResult shape (golden rule).
import type { Network, Source } from '@reduit/shared';
import { resolveMode } from '../config.js';
import { simSubmit } from './simAdapter.js';
import { liveSubmit } from './liveAdapter.js';

export interface SubmitRequest {
  method:
    | 'Payment'
    | 'VaultCreate'
    | 'VaultDeposit'
    | 'VaultWithdraw'
    | 'LoanBrokerSet'
    | 'LoanBrokerCoverDeposit'
    | 'LoanSet'
    | 'LoanPay'
    | 'LoanManage'
    | 'SetRegularKey'
    | 'DepositPreauth'
    | 'EscrowCreate';
  network: Network;
  /** signer wallet key — for the agent sweep this is the agent's REGULAR key, not the master (AG5). */
  signer?: 'hq' | 'agent' | 'broker' | 'vault';
  /** for inter-country transfers: the source entity signs with its own wallet (live). Overrides
   *  `signer` for Payments unless signer === 'agent' (the autonomous sweep keeps the regular key). */
  sourceEntityId?: string;
  fields: Record<string, unknown>;
}

export interface SubmitResult {
  source: Source;
  network: Network;
  txHash: string | null;
  explorerUrl: string | null;
  validated: boolean;
  raw?: unknown;
  /** Set after LoanBrokerSet: the on-chain LoanBroker ledger object ID. */
  loanBrokerId?: string | null;
  /** Set after LoanSet: the on-chain Loan ledger object ID (used for LoanPay / LoanManage). */
  loanId?: string | null;
}

export async function submit(req: SubmitRequest): Promise<SubmitResult> {
  const mode = resolveMode(req.network, req.method);
  return mode === 'live' ? liveSubmit(req) : simSubmit(req);
}
