// XLS-66 native on-chain operations using xrpl.js v4.6.0.
//
// All tx types (LoanBrokerSet, LoanBrokerCoverDeposit, LoanSet, LoanPay, LoanManage)
// are first-class citizens in the Transaction union — no `as any` needed for signing.
//
// LoanSet dual signing:
//   1. HQ (LoanBroker.Owner) signs first via wallet.sign()
//   2. Borrower (vault wallet) adds CounterpartySignature via signLoanSetByCounterparty()
//   3. Submit the combined tx_blob
//
// On-chain amounts are 1 XRP (demo proof); app accounting tracks CHF values internally.
import {
  xrpToDrops,
  signLoanSetByCounterparty,
  type LoanBrokerSet,
  type LoanBrokerCoverDeposit,
  type LoanSet,
  type LoanPay,
  type LoanManage,
} from 'xrpl';
import { getClient } from './client.js';
import { resolveDevnetSigner } from './wallets.js';
import type { SubmitResult } from './submit.js';

const NETWORK = 'devnet' as const;
const EXPLORER = 'https://devnet.xrpl.org/transactions/';

// ── helpers ───────────────────────────────────────────────────────────────────

function envRequired(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`loanOps: missing ${name} in .env`);
  return v;
}

function resultCode(meta: unknown): string | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  return (meta as { TransactionResult?: string }).TransactionResult;
}

function makeResult(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res: any,
  signedHash: string,
  /** Extra tec* codes to accept as success (e.g. tecKILLED = loan fully paid/closed). */
  acceptCodes: string[] = [],
): SubmitResult {
  const r = res.result as { hash?: string | null; validated?: boolean; meta?: unknown };
  const txHash = (r.hash ?? signedHash) as string | null;
  const code = resultCode(r.meta);
  if (code !== 'tesSUCCESS' && !acceptCodes.includes(code ?? ''))
    throw new Error(`XLS-66 tx failed: ${code ?? 'unknown'} (hash ${txHash ?? 'n/a'})`);
  return {
    source: 'LIVE',
    network: NETWORK,
    txHash,
    explorerUrl: txHash ? `${EXPLORER}${txHash}` : null,
    validated: r.validated === true,
    raw: res.result,
  };
}

function extractCreatedId(meta: unknown, ledgerEntryType: string): string | null {
  const nodes =
    ((meta as Record<string, unknown> | null)?.AffectedNodes as unknown[] | undefined) ?? [];
  for (const node of nodes) {
    const c = (node as Record<string, unknown>).CreatedNode as
      | Record<string, unknown>
      | undefined;
    if (c?.LedgerEntryType === ledgerEntryType) return (c.LedgerIndex as string) ?? null;
  }
  return null;
}

function loanBrokerId(): string {
  return envRequired('LOAN_BROKER_ID_DEVNET');
}

// ── 1 · LoanBrokerSet ─────────────────────────────────────────────────────────
// Creates the LoanBroker object linked to our XRP vault. Run once; store result
// as LOAN_BROKER_ID_DEVNET in .env via POST /loan-broker/setup.

export async function nativeLoanBrokerSet(): Promise<SubmitResult & { loanBrokerId: string | null }> {
  const { account, wallet } = resolveDevnetSigner('hq');
  const client = await getClient(NETWORK);

  const tx: LoanBrokerSet = {
    TransactionType: 'LoanBrokerSet',
    Account: account,
    VaultID: envRequired('XRP_VAULT_ID_DEVNET'),
  };
  const prepared = await client.autofill(tx);
  const signed = wallet.sign(prepared);
  const res = await client.submitAndWait(signed.tx_blob);
  const base = makeResult(res, signed.hash);
  return { ...base, loanBrokerId: extractCreatedId(res.result.meta, 'LoanBroker') };
}

// ── 2 · LoanBrokerCoverDeposit ────────────────────────────────────────────────
// Deposits first-loss capital (1 XRP on-chain proof). Requires LOAN_BROKER_ID_DEVNET.

export async function nativeLoanBrokerCoverDeposit(): Promise<SubmitResult> {
  const { account, wallet } = resolveDevnetSigner('hq');
  const client = await getClient(NETWORK);

  const tx: LoanBrokerCoverDeposit = {
    TransactionType: 'LoanBrokerCoverDeposit',
    Account: account,
    LoanBrokerID: loanBrokerId(),
    Amount: xrpToDrops('1'),
  };
  const prepared = await client.autofill(tx);
  const signed = wallet.sign(prepared);
  const res = await client.submitAndWait(signed.tx_blob);
  return makeResult(res, signed.hash);
}

// ── 3 · LoanSet (dual signing) ────────────────────────────────────────────────
// HQ (LoanBroker.Owner) signs first; vault wallet (borrower on devnet) countersigns
// via signLoanSetByCounterparty(). Requires LOAN_BROKER_ID_DEVNET.

export async function nativeLoanSet(): Promise<SubmitResult & { loanId: string | null }> {
  const broker = resolveDevnetSigner('hq');
  const borrower = resolveDevnetSigner('depositor'); // vault wallet acts as borrower on devnet
  const client = await getClient(NETWORK);

  const tx: LoanSet = {
    TransactionType: 'LoanSet',
    Account: broker.account,
    LoanBrokerID: loanBrokerId(),
    PrincipalRequested: xrpToDrops('1'), // 1 XRP on-chain proof; app tracks CHF
    Counterparty: borrower.account,
  };

  // Step 1: autofill (Sequence, Fee, LastLedgerSequence)
  const autofilled = await client.autofill(tx);

  // Step 2: HQ signs first (LoanBroker.Owner must sign the tx body)
  const hqSigned = broker.wallet.sign(autofilled);

  // Step 3: borrower adds CounterpartySignature (signs over the same body via encodeForSigning)
  const { tx_blob: finalBlob } = signLoanSetByCounterparty(borrower.wallet, hqSigned.tx_blob);

  // Step 4: submit the dual-signed tx
  const res = await client.submitAndWait(finalBlob);
  const base = makeResult(res, hqSigned.hash);
  return { ...base, loanId: extractCreatedId(res.result.meta, 'Loan') };
}

// ── 4 · LoanPay ───────────────────────────────────────────────────────────────
// Borrower (vault wallet) repays the loan in full.

export async function nativeLoanPay(loanId: string): Promise<SubmitResult> {
  const { account, wallet } = resolveDevnetSigner('depositor'); // borrower on devnet
  const client = await getClient(NETWORK);

  // No tfLoanFullPayment flag: let the devnet decide the payment semantics.
  // tfLoanFullPayment triggers tecKILLED on this devnet build if the protocol-computed
  // close amount differs from our 1-XRP amount (close fees, rounding, etc.).
  const tx: LoanPay = {
    TransactionType: 'LoanPay',
    Account: account,
    LoanID: loanId,
    Amount: xrpToDrops('1'),
  };
  const prepared = await client.autofill(tx);
  const signed = wallet.sign(prepared);
  const res = await client.submitAndWait(signed.tx_blob);
  return makeResult(res, signed.hash); // strict: only tesSUCCESS accepted
}

// ── 5 · LoanManage ────────────────────────────────────────────────────────────
// HQ (LoanBroker.Owner) impairs, clears, or defaults a loan.

export async function nativeLoanManage(
  loanId: string,
  action: 'impair' | 'clear' | 'default',
): Promise<SubmitResult> {
  const { account, wallet } = resolveDevnetSigner('hq');
  const client = await getClient(NETWORK);

  const flagMap = {
    default: 0x10000, // tfLoanDefault  = 65536
    impair:  0x20000, // tfLoanImpair   = 131072
    clear:   0x40000, // tfLoanUnimpair = 262144
  } as const;

  const tx: LoanManage = {
    TransactionType: 'LoanManage',
    Account: account,
    LoanID: loanId,
    Flags: flagMap[action],
  };
  const prepared = await client.autofill(tx);
  const signed = wallet.sign(prepared);
  const res = await client.submitAndWait(signed.tx_blob);
  return makeResult(res, signed.hash);
}
