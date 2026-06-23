// Real xrpl.js calls for Devnet (XLS-65 + XLS-66) and Testnet (Payment).
//
// XLS-65 VaultDeposit/VaultWithdraw: real VaultDeposit/VaultWithdraw tx using DEVNET seeds.
// XLS-66 Loan*: native tx types via loanOps.ts (LoanBrokerSet, LoanBrokerCoverDeposit,
//   LoanSet dual-signed, LoanPay, LoanManage). Falls back to Payment+memo if the devnet
//   build doesn't recognise a native tx type (temUNKNOWN / temDISABLED) or if
//   LOAN_BROKER_ID_DEVNET is not yet set.
// Payment: real RLUSD or XRP on Testnet (existing flow unchanged).
import { convertStringToHex, xrpToDrops, type Payment } from 'xrpl';
import {
  nativeLoanBrokerSet,
  nativeLoanBrokerCoverDeposit,
  nativeLoanSet,
  nativeLoanPay,
  nativeLoanManage,
} from './loanOps.js';
import type { SubmitRequest, SubmitResult } from './submit.js';
import { getClient } from './client.js';
import { resolveSigner, resolveDevnetSigner, resolveSignerByEntity, type Signer } from './wallets.js';
import { toCurrencyHex } from './currency.js';

const EXPLORER: Record<string, string> = {
  testnet: 'https://testnet.xrpl.org/transactions/',
  devnet: 'https://devnet.xrpl.org/transactions/',
};

const LOAN_METHODS = new Set([
  'LoanBrokerSet',
  'LoanBrokerCoverDeposit',
  'LoanSet',
  'LoanPay',
  'LoanManage',
]);

export async function liveSubmit(req: SubmitRequest): Promise<SubmitResult> {
  if (req.method === 'Payment') return livePayment(req);
  if (req.method === 'VaultCreate') return liveVaultCreate(req);
  if (req.method === 'VaultDeposit') return liveVaultDeposit(req);
  if (req.method === 'VaultWithdraw') return liveVaultWithdraw(req);
  if (LOAN_METHODS.has(req.method)) return liveLoanOp(req);
  throw new Error(
    `liveAdapter: "${req.method}" is not wired for LIVE on ${req.network}.`,
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

function envRequired(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`liveAdapter: missing ${name} in .env`);
  return v;
}

function resultCode(meta: unknown): string | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  return (meta as { TransactionResult?: string }).TransactionResult;
}

function makeResult(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  res: any,
  signedHash: string | null,
  network: string,
): SubmitResult {
  const r = res.result as { hash?: string | null; validated?: boolean; meta?: unknown };
  const txHash = (r.hash ?? signedHash) as string | null;
  const code = resultCode(res.result.meta);
  if (code !== 'tesSUCCESS')
    throw new Error(`XRPL tx failed: ${code ?? 'unknown'} (hash ${txHash ?? 'n/a'})`);
  return {
    source: 'LIVE',
    network: network as SubmitResult['network'],
    txHash,
    explorerUrl: txHash ? `${EXPLORER[network] ?? ''}${txHash}` : null,
    validated: res.result.validated === true,
    raw: res.result,
  };
}

// ── Payment (Testnet) ─────────────────────────────────────────────────────────

interface PaymentFields {
  to: string;
  amount: string;
  currency?: string;
  memo?: Record<string, unknown>;
}

async function livePayment(req: SubmitRequest): Promise<SubmitResult> {
  const issuer = process.env.RLUSD_ISSUER_TESTNET?.trim();
  const { to, amount, currency, memo } = req.fields as unknown as PaymentFields;
  if (!to || !amount) throw new Error('Payment requires fields.to and fields.amount.');

  const { account, wallet } =
    req.signer === 'agent'
      ? resolveSigner('agent')
      : req.sourceEntityId
        ? resolveSignerByEntity(req.sourceEntityId)
        : resolveSigner((req.signer ?? 'hq') as Signer);
  const client = await getClient(req.network);

  const buildTx = (useXrp: boolean): Payment => {
    const tx: Payment = {
      TransactionType: 'Payment',
      Account: account,
      Destination: to,
      Amount: useXrp
        ? xrpToDrops('1')
        : { currency: toCurrencyHex(currency ?? 'RLUSD'), issuer: issuer!, value: amount },
    };
    if (memo) tx.Memos = [{ Memo: { MemoData: convertStringToHex(JSON.stringify(memo)) } }];
    return tx;
  };

  const trySubmit = async (useXrp: boolean) => {
    const prepared = await client.autofill(buildTx(useXrp));
    const signed = wallet.sign(prepared);
    const result = await client.submitAndWait(signed.tx_blob);
    const code = resultCode(result.result.meta);
    return { result, code, txHash: result.result.hash ?? signed.hash };
  };

  let { result, code, txHash } = await trySubmit(!issuer);
  if (code === 'tecPATH_DRY' && issuer) {
    ({ result, code, txHash } = await trySubmit(true));
  }
  if (code !== 'tesSUCCESS')
    throw new Error(`Live Payment on ${req.network} failed: ${code ?? 'unknown'} (hash ${txHash}).`);

  return {
    source: 'LIVE',
    network: req.network,
    txHash,
    explorerUrl: `${EXPLORER[req.network]}${txHash}`,
    validated: result.result.validated === true,
    raw: result.result,
  };
}

// ── XLS-65 VaultCreate (Devnet) ───────────────────────────────────────────────

async function liveVaultCreate(req: SubmitRequest): Promise<SubmitResult> {
  const { asset = 'XRP' } = req.fields as { asset?: string };
  const { account, wallet } = resolveDevnetSigner('hq');
  const client = await getClient(req.network);

  const xrplAsset =
    asset === 'XRP'
      ? { currency: 'XRP' }
      : { currency: envRequired('RLUSD_CURRENCY_DEVNET'), issuer: envRequired('RLUSD_ISSUER_DEVNET') };

  const tx = { TransactionType: 'VaultCreate', Account: account, Asset: xrplAsset };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prepared = await client.autofill(tx as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signed = wallet.sign(prepared as any);
  const res = await client.submitAndWait(signed.tx_blob);
  return makeResult(res, signed.hash, req.network);
}

// ── XLS-65 VaultDeposit (Devnet) ─────────────────────────────────────────────

async function liveVaultDeposit(req: SubmitRequest): Promise<SubmitResult> {
  // Use devnet depositor wallet + real XLS-65 VaultDeposit tx.
  // App amounts are internal CHF units; on-chain we send 1 XRP as demo proof.
  const vaultId = process.env.XRP_VAULT_ID_DEVNET?.trim() || envRequired('VAULT_ID_DEVNET');
  const { account, wallet } = resolveDevnetSigner('depositor');
  const client = await getClient(req.network);

  const tx = {
    TransactionType: 'VaultDeposit',
    Account: account,
    VaultID: vaultId,
    Amount: xrpToDrops('1'), // 1 XRP on-chain proof (app accounting tracks CHF amounts)
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prepared = await client.autofill(tx as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signed = wallet.sign(prepared as any);
  const res = await client.submitAndWait(signed.tx_blob);
  return makeResult(res, signed.hash, req.network);
}

// ── XLS-65 VaultWithdraw (Devnet) ────────────────────────────────────────────

async function liveVaultWithdraw(req: SubmitRequest): Promise<SubmitResult> {
  const vaultId = process.env.XRP_VAULT_ID_DEVNET?.trim() || envRequired('VAULT_ID_DEVNET');
  const { account, wallet } = resolveDevnetSigner('depositor');
  const client = await getClient(req.network);

  const tx = {
    TransactionType: 'VaultWithdraw',
    Account: account,
    VaultID: vaultId,
    Amount: xrpToDrops('1'), // 1 XRP on-chain proof
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prepared = await client.autofill(tx as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signed = wallet.sign(prepared as any);
  const res = await client.submitAndWait(signed.tx_blob);
  return makeResult(res, signed.hash, req.network);
}

// ── XLS-66 Loan operations (Devnet) ──────────────────────────────────────────
//
// Dispatches to native XLS-66 transaction types via loanOps.ts (xrpl.js v4.6.0
// has full type support). Falls back to Payment+memo if:
//   • LOAN_BROKER_ID_DEVNET is not set (LoanBrokerSet not yet run)
//   • The devnet build returns temUNKNOWN or temDISABLED for a native tx type

async function liveLoanOp(req: SubmitRequest): Promise<SubmitResult> {
  const { method, fields } = req;

  // LoanBrokerSet is triggered via POST /loan-broker/setup, not through submit().
  // If called here (e.g. from a test), fall through to memo fallback.
  if (method === 'LoanBrokerSet') {
    try {
      return await nativeLoanBrokerSet();
    } catch (e) {
      return liveLoanOpMemo(req, e as Error);
    }
  }

  try {
    if (method === 'LoanBrokerCoverDeposit') {
      return await nativeLoanBrokerCoverDeposit();
    }

    if (method === 'LoanSet') {
      return await nativeLoanSet();
    }

    if (method === 'LoanPay') {
      const { loan_id } = fields as { loan_id?: string | null };
      if (!loan_id) {
        // No on-chain LoanID (e.g. loan was created in SIM mode) — use memo fallback
        return liveLoanOpMemo(req, new Error('No loan_id available for native LoanPay'));
      }
      return await nativeLoanPay(loan_id);
    }

    if (method === 'LoanManage') {
      const { loan_id, action } = fields as { loan_id?: string | null; action?: string };
      if (!loan_id) {
        return liveLoanOpMemo(req, new Error('No loan_id available for native LoanManage'));
      }
      return await nativeLoanManage(loan_id, (action ?? 'impair') as 'impair' | 'clear' | 'default');
    }

    throw new Error(`liveLoanOp: unhandled method "${method}"`);
  } catch (e) {
    const msg = (e as Error).message ?? '';
    // Gracefully fall back when: broker not set up, devnet amendment not enabled, or
    // any temXXX result — so the demo keeps working even on older devnet builds.
    if (
      msg.includes('LOAN_BROKER_ID_DEVNET') ||
      msg.includes('temUNKNOWN') ||
      msg.includes('temDISABLED') ||
      msg.includes('temMALFORMED') ||
      msg.includes('tecKILLED')   // LoanPay: close amount mismatch on this devnet build
    ) {
      console.warn(`[liveAdapter] XLS-66 native tx failed ("${msg}") — falling back to Payment+memo`);
      return liveLoanOpMemo(req, e as Error);
    }
    throw e;
  }
}

// Payment+memo fallback: 1 drop HQ→Vault with xls66_op in MemoData.
// Produces a real on-chain ledger entry and is verifiable on the devnet explorer.
async function liveLoanOpMemo(req: SubmitRequest, _cause?: Error): Promise<SubmitResult> {
  const { account, wallet } = resolveDevnetSigner('hq');
  const destination = envRequired('VAULT_ADDRESS_DEVNET');
  const client = await getClient(req.network);

  const memoData = convertStringToHex(
    JSON.stringify({ xls66_op: req.method, ...req.fields }),
  );

  const tx: Payment = {
    TransactionType: 'Payment',
    Account: account,
    Destination: destination,
    Amount: '1', // 1 drop — minimal; memo carries the semantic payload
    Memos: [{ Memo: { MemoData: memoData } }],
  };
  const prepared = await client.autofill(tx);
  const signed = wallet.sign(prepared);
  const res = await client.submitAndWait(signed.tx_blob);
  return makeResult(res, signed.hash, req.network);
}
