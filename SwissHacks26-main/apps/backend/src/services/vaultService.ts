// XLS-65 Single Asset Vault — Devnet live implementation.
//
// This is the single source of truth for all XLS-65 vault operations.
// Env vars owned here: XRP_VAULT_ID_DEVNET, RLUSD_VAULT_ID_DEVNET,
//   RLUSD_CURRENCY_DEVNET, RLUSD_ISSUER_DEVNET,
//   HQ_WALLET_SEED_DEVNET (VaultCreate), VAULT_WALLET_SEED_DEVNET (Deposit/Withdraw).
// Never touches mainnet or testnet seeds (resolveDevnetSigner only).
//
// RLUSD currency code: MUST be the 40-char uppercase hex (RLUSD_CURRENCY_DEVNET).
// Plain "RLUSD" is rejected by xrpl.js as an invalid currency code.
import { xrpToDrops } from 'xrpl';
import { getClient } from '../xrpl/client.js';
import { resolveDevnetSigner } from '../xrpl/wallets.js';
import { simSubmit } from '../xrpl/simAdapter.js';
import { resolveMode } from '../config.js';
import type { SubmitResult } from '../xrpl/submit.js';

export type VaultAsset = 'XRP' | 'RLUSD';

export interface VaultInfo {
  vaultId: string;
  assetsTotal: string;
  assetsAvailable: string;
  outstandingAmount: string;
  shareMPTID: string | null;
}

export interface CreateVaultResult extends SubmitResult {
  vaultId: string | null;
}

const NETWORK = 'devnet' as const;
const EXPLORER = 'https://devnet.xrpl.org/transactions/';

// ── env guards ───────────────────────────────────────────────────────────────

function requiredEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) throw new Error(`Missing ${name} in .env — required for XLS-65 vault operations.`);
  return v;
}

/** Validates all env vars needed for live devnet ops. Call at startup or before first use. */
export function validateDevnetEnv(): void {
  const needed = [
    'DEVNET_RPC_URL',
    'HQ_WALLET_SEED_DEVNET',
    'VAULT_WALLET_SEED_DEVNET',
    'XRP_VAULT_ID_DEVNET',
    'RLUSD_ISSUER_DEVNET',
    'RLUSD_CURRENCY_DEVNET',
    'RLUSD_VAULT_ID_DEVNET',
  ];
  const missing = needed.filter((k) => !process.env[k]?.trim());
  if (missing.length > 0)
    throw new Error(`XLS-65 devnet env vars missing: ${missing.join(', ')}. Check .env.`);
}

// ── XRPL field builders ───────────────────────────────────────────────────────

function rlusdCurrency(): string {
  // Returns the 40-char hex code stored in RLUSD_CURRENCY_DEVNET.
  // Must NOT be "RLUSD" — xrpl.js requires hex for >3-char currency codes.
  return requiredEnv('RLUSD_CURRENCY_DEVNET');
}

function rlusdIssuer(): string {
  return requiredEnv('RLUSD_ISSUER_DEVNET');
}

function xrpVaultId(): string {
  // XRP_VAULT_ID_DEVNET is canonical; VAULT_ID_DEVNET is kept for backwards compat.
  return process.env.XRP_VAULT_ID_DEVNET?.trim() || requiredEnv('VAULT_ID_DEVNET');
}

function rlusdVaultId(): string {
  return requiredEnv('RLUSD_VAULT_ID_DEVNET');
}


function validateAsset(asset: VaultAsset): void {
  if (asset !== 'XRP' && asset !== 'RLUSD')
    throw new Error(`Invalid vault asset "${asset as string}". Must be "XRP" or "RLUSD".`);
}

function buildAsset(asset: VaultAsset): { currency: string; issuer?: string } {
  if (asset === 'XRP') return { currency: 'XRP' };
  // RLUSD: use the pre-computed 40-char hex currency code
  return { currency: rlusdCurrency(), issuer: rlusdIssuer() };
}

function buildAmount(amount: string, asset: VaultAsset): string | { currency: string; issuer: string; value: string } {
  if (asset === 'XRP') return xrpToDrops(amount); // XRP always in drops
  // RLUSD: IOU object with hex currency code
  return { currency: rlusdCurrency(), issuer: rlusdIssuer(), value: amount };
}

// ── helpers ───────────────────────────────────────────────────────────────────

function txCode(meta: unknown): string | undefined {
  if (!meta || typeof meta !== 'object') return undefined;
  return (meta as { TransactionResult?: string }).TransactionResult;
}

function extractCreatedVaultId(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null;
  const nodes = (meta as { AffectedNodes?: unknown[] }).AffectedNodes ?? [];
  for (const node of nodes) {
    const created = (node as { CreatedNode?: { LedgerEntryType?: string; LedgerIndex?: string } }).CreatedNode;
    if (created?.LedgerEntryType === 'Vault') return created.LedgerIndex ?? null;
  }
  return null;
}

function okOrThrow(code: string | undefined, label: string, txHash: string | null | undefined): void {
  if (code !== 'tesSUCCESS')
    throw new Error(`${label} failed: ${code ?? 'unknown result'} (hash ${txHash ?? 'n/a'})`);
}

// ── core operations ───────────────────────────────────────────────────────────

/** Create a new XLS-65 single-asset vault on Devnet. Returns txHash + the new vault's LedgerIndex. */
export async function createVault(asset: VaultAsset): Promise<CreateVaultResult> {
  validateAsset(asset);

  if (resolveMode(NETWORK, 'VaultCreate') === 'sim') {
    const r = await simSubmit({ method: 'VaultCreate', network: NETWORK, fields: { asset } });
    return { ...r, vaultId: null };
  }

  const { account, wallet } = resolveDevnetSigner('hq');
  const client = await getClient(NETWORK);

  const tx = { TransactionType: 'VaultCreate', Account: account, Asset: buildAsset(asset) };
  // XLS-65 tx types are not yet in xrpl.js v4's Transaction union — cast required
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prepared = await client.autofill(tx as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signed = wallet.sign(prepared as any);
  const res = await client.submitAndWait(signed.tx_blob);

  const meta = res.result.meta;
  const code = txCode(meta);
  const txHash = res.result.hash ?? signed.hash;
  okOrThrow(code, `VaultCreate (${asset})`, txHash);

  return {
    source: 'LIVE',
    network: NETWORK,
    txHash,
    explorerUrl: `${EXPLORER}${txHash}`,
    validated: res.result.validated === true,
    raw: res.result,
    vaultId: extractCreatedVaultId(meta),
  };
}

/** Generic deposit — pass the exact vaultId and asset type. */
export async function depositVault(vaultId: string, amount: string, asset: VaultAsset): Promise<SubmitResult> {
  validateAsset(asset);
  if (!vaultId) throw new Error('depositVault: vaultId is required.');
  if (!amount || Number(amount) <= 0) throw new Error('depositVault: amount must be a positive number.');

  if (resolveMode(NETWORK, 'VaultDeposit') === 'sim') {
    return simSubmit({ method: 'VaultDeposit', network: NETWORK, fields: { vaultId, amount, asset } });
  }

  const { account, wallet } = resolveDevnetSigner('depositor');
  const client = await getClient(NETWORK);

  const tx = {
    TransactionType: 'VaultDeposit',
    Account: account,
    VaultID: vaultId,
    Amount: buildAmount(amount, asset),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prepared = await client.autofill(tx as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signed = wallet.sign(prepared as any);
  const res = await client.submitAndWait(signed.tx_blob);

  const meta = res.result.meta;
  const code = txCode(meta);
  const txHash = res.result.hash ?? signed.hash;
  okOrThrow(code, `VaultDeposit (${asset} ${amount})`, txHash);

  return {
    source: 'LIVE',
    network: NETWORK,
    txHash,
    explorerUrl: `${EXPLORER}${txHash}`,
    validated: res.result.validated === true,
    raw: res.result,
  };
}

/** Generic withdraw — pass the exact vaultId and asset type. */
export async function withdrawVault(vaultId: string, amount: string, asset: VaultAsset): Promise<SubmitResult> {
  validateAsset(asset);
  if (!vaultId) throw new Error('withdrawVault: vaultId is required.');
  if (!amount || Number(amount) <= 0) throw new Error('withdrawVault: amount must be a positive number.');

  if (resolveMode(NETWORK, 'VaultWithdraw') === 'sim') {
    return simSubmit({ method: 'VaultWithdraw', network: NETWORK, fields: { vaultId, amount, asset } });
  }

  const { account, wallet } = resolveDevnetSigner('depositor');
  const client = await getClient(NETWORK);

  const tx = {
    TransactionType: 'VaultWithdraw',
    Account: account,
    VaultID: vaultId,
    Amount: buildAmount(amount, asset),
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prepared = await client.autofill(tx as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const signed = wallet.sign(prepared as any);
  const res = await client.submitAndWait(signed.tx_blob);

  const meta = res.result.meta;
  const code = txCode(meta);
  const txHash = res.result.hash ?? signed.hash;
  okOrThrow(code, `VaultWithdraw (${asset} ${amount})`, txHash);

  return {
    source: 'LIVE',
    network: NETWORK,
    txHash,
    explorerUrl: `${EXPLORER}${txHash}`,
    validated: res.result.validated === true,
    raw: res.result,
  };
}

// ── convenience methods (resolve vault ID from env automatically) ──────────────

/** Deposit XRP into the configured XRP vault. amountXrp is in whole XRP (e.g. "10"). */
export async function depositXrpVault(amountXrp: string): Promise<SubmitResult> {
  return depositVault(xrpVaultId(), amountXrp, 'XRP');
}

/** Withdraw XRP from the configured XRP vault. amountXrp is in whole XRP (e.g. "5"). */
export async function withdrawXrpVault(amountXrp: string): Promise<SubmitResult> {
  return withdrawVault(xrpVaultId(), amountXrp, 'XRP');
}

/** Deposit RLUSD into the configured RLUSD vault. amountRlusd is a decimal string (e.g. "100"). */
export async function depositRlusdVault(amountRlusd: string): Promise<SubmitResult> {
  return depositVault(rlusdVaultId(), amountRlusd, 'RLUSD');
}

/** Withdraw RLUSD from the configured RLUSD vault. amountRlusd is a decimal string (e.g. "50"). */
export async function withdrawRlusdVault(amountRlusd: string): Promise<SubmitResult> {
  return withdrawVault(rlusdVaultId(), amountRlusd, 'RLUSD');
}

// ── vault info ────────────────────────────────────────────────────────────────

/**
 * Query on-chain vault state via vault_info RPC.
 * Returns zero-state when FORCE_SIM=true (no network call made).
 */
export async function getVaultInfo(vaultId: string): Promise<VaultInfo> {
  if (!vaultId) throw new Error('getVaultInfo: vaultId is required.');

  if (process.env.FORCE_SIM === 'true') {
    return { vaultId, assetsTotal: '0', assetsAvailable: '0', outstandingAmount: '0', shareMPTID: null };
  }

  const client = await getClient(NETWORK);
  // vault_info: spec (XLS-65 §3.9.1) uses field name "vault"; some devnet builds use "vault_id".
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await client.request({ command: 'vault_info', vault: vaultId, vault_id: vaultId } as any);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const vault = (res.result as any)?.vault ?? (res.result as any);

  return {
    vaultId: vault?.index ?? vault?.LedgerIndex ?? vaultId,
    assetsTotal: String(vault?.AssetsTotal ?? '0'),
    assetsAvailable: String(vault?.AssetsAvailable ?? '0'),
    // spec §3.9.2: OutstandingAmount lives under vault.shares; fall back to top-level for devnet builds
    outstandingAmount: String(vault?.shares?.OutstandingAmount ?? vault?.OutstandingAmount ?? '0'),
    // spec §3.9.2: ShareMPTID; some builds return MPTokenIssuanceID
    shareMPTID: vault?.ShareMPTID ?? vault?.shares?.mpt_issuance_id ?? vault?.MPTokenIssuanceID ?? null,
  };
}

/** Get info for the configured XRP vault (reads XRP_VAULT_ID_DEVNET from env). */
export async function getXrpVaultInfo(): Promise<VaultInfo> {
  return getVaultInfo(xrpVaultId());
}

/** Get info for the configured RLUSD vault (reads RLUSD_VAULT_ID_DEVNET from env). */
export async function getRlusdVaultInfo(): Promise<VaultInfo> {
  return getVaultInfo(rlusdVaultId());
}
